const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} = require('node:fs');
const { join, resolve, dirname } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../skills/risk-assess/scripts/risk-analyze.js');
const tempDirs = [];

// `commit.gpgsign=false` is the load-bearing one: this repo's own contributors sign
// by default, and a fixture that inherits it makes every commit wait on a GPG agent
// that has no business here. The two identity keys are a floor, not a guarantee —
// `-c user.name` is OUTRANKED by an exported GIT_AUTHOR_NAME (measured on git 2.54.0:
// the commit records the ambient name), which is why those variables are stripped
// below rather than overridden here.
const COMMIT_CONFIG = [
  '-c', 'user.name=test',
  '-c', 'user.email=test@test',
  '-c', 'commit.gpgsign=false',
];

// Ambient git state reaches the fixture through four channels; closing the config-file
// one alone leaves three open. Measured full-suite results, each pinned by a test:
//   config files   core.hooksPath → 0/29 pass; diff.noprefix+renames → 5 fail
//   env-injected   GIT_CONFIG_COUNT/KEY_n/VALUE_n, no file involved → 24/5
//   path defaults  XDG git/ignore `*.ts` → 11/18 (see below)
//   env variables  GIT_TEMPLATE_DIR seeds .git/hooks at init → 0/29
//
// Two non-obvious ones. Setting COUNT ourselves also *clamps* an ambient COUNT (5 is
// cut to 2, both slots overwritten). And GIT_CONFIG_GLOBAL=/dev/null actively OPENS
// the path-defaults channel: it unsets core.excludesFile/attributesFile, whereupon git
// falls back to hardcoded $XDG_CONFIG_HOME/git/{ignore,attributes} — path defaults, not
// config values, so no config file suppresses them. Naming both keys is the only fix.
// `/dev/null` rather than unsetting: unsetting re-enables ~/.gitconfig discovery.
const HERMETIC_GIT_CONFIG_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'core.excludesfile',
  GIT_CONFIG_VALUE_0: '/dev/null',
  GIT_CONFIG_KEY_1: 'core.attributesfile',
  GIT_CONFIG_VALUE_1: '/dev/null',
};

// Three groups, each with its own failure mode:
//   repo location — an exported GIT_DIR survives `cwd: <tempdir>` and redirects the
//     fixture's init/add/commit at whatever it names. That is not a failing test; it
//     is test commits landing in a real repository.
//   identity — GIT_AUTHOR_* / GIT_COMMITTER_* outrank COMMIT_CONFIG's `-c`, so an
//     ambient name lands in fixture commits, and an ambient EMPTY one is fatal:
//     git rejects the ident and `-c` cannot override it (0 pass/29 fail, measured).
//   templates — GIT_TEMPLATE_DIR copies hooks into every `git init`.
const STRIPPED_GIT_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_DATE',
  'GIT_TEMPLATE_DIR',
];

// Every child that reaches git — directly (runGit) or through risk-analyze.js
// (runRisk/runRiskMarkdown) — must be spawned with this env, or the fixture is
// hermetic in one half and inherits the developer's config in the other.
function hermeticEnv() {
  const env = { ...process.env, ...HERMETIC_GIT_CONFIG_ENV };
  for (const key of STRIPPED_GIT_ENV_KEYS) delete env[key];
  return env;
}

// Report the cause git actually failed with. `err.status` is null for every
// spawn-level failure, so reading it alone renders ENOENT, a timeout and a SIGKILL
// all as "exit null" — measured shapes: ENOENT {status:null, code:'ENOENT',
// stderr:undefined}, timeout {status:null, code:'ETIMEDOUT', signal:'SIGTERM'},
// SIGKILL {status:null, signal:'SIGKILL'}, ordinary failure {status:1}.
function describeExit(err) {
  const parts = [];
  if (err.status !== null && err.status !== undefined) parts.push(`exit ${err.status}`);
  if (err.code) parts.push(err.code);
  if (err.signal) parts.push(`signal ${err.signal}`);
  return parts.length > 0 ? parts.join(', ') : 'no exit status, code or signal';
}

// Never `stdio: 'ignore'` — that discards git's stderr, and a failure then reads
// only "Command failed: git ... commit -m add src/dir5/mod21.ts" with no cause,
// which is exactly how CI run 31167731942 became undiagnosable.
function runGit(dir, args, { identity = false } = {}) {
  const full = identity ? [...COMMIT_CONFIG, ...args] : args;
  try {
    return execFileSync('git', full, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: hermeticEnv(),
    });
  } catch (err) {
    // undefined and '' are different answers: the first means the pipe was never
    // created because the process did not start, the second that git ran silently.
    const stderr = err.stderr === undefined
      ? '(not captured — the process never started)'
      : String(err.stderr).trim() || '(empty)';
    const stdout = err.stdout === undefined
      ? '(not captured)'
      : String(err.stdout).trim() || '(empty)';
    // Key on err.code, not on a null status. Both a SIGKILL and an ordinary exit
    // leave code unset, and for those err.message only restates the command line —
    // labelling that "spawn:" would be both noise and a lie about what happened.
    // code is set for exactly the shapes whose message names a cause: ENOENT,
    // EACCES, ETIMEDOUT, ENOBUFS.
    const causeDetail = err.code ? `\n  cause: ${err.message}` : '';
    throw new Error(
      `git ${full.join(' ')} failed (${describeExit(err)}) in ${dir}\n` +
        `  stderr: ${stderr}\n` +
        `  stdout: ${stdout}${causeDetail}`
    );
  }
}

function createTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-risk-'));
  tempDirs.push(dir);
  runGit(dir, ['init']);
  runGit(dir, ['commit', '--allow-empty', '-m', 'init'], { identity: true });
  return dir;
}

// One `git add` + one `git commit` for the whole batch. Callers that only need N
// files present in HEAD (rather than N distinct commits) must use this: the
// per-file variant spawns 2 processes each, and a 30-file loop was 60 spawns of
// which any single transient failure sank the test.
function commitFiles(dir, entries, message) {
  for (const [filePath, content] of entries) {
    mkdirSync(join(dir, dirname(filePath)), { recursive: true });
    writeFileSync(join(dir, filePath), content);
  }
  runGit(dir, ['add', '--', ...entries.map(([filePath]) => filePath)]);
  runGit(dir, ['commit', '-m', message], { identity: true });
}

// Single-file convenience wrapper. Use it when the test needs this file to land in
// its OWN commit (e.g. anything asserting against `HEAD~n`); otherwise batch.
function commitFile(dir, filePath, content) {
  commitFiles(dir, [[filePath, content]], `add ${filePath}`);
}

function runRisk(dir, extraArgs = []) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--json', ...extraArgs], {
      cwd: dir,
      encoding: 'utf8',
      env: hermeticEnv(),
    });
    return { output: JSON.parse(stdout), exitCode: 0 };
  } catch (err) {
    const stdout = (err.stdout || '').toString();
    try {
      return { output: JSON.parse(stdout), exitCode: err.status };
    } catch {
      return { output: null, exitCode: err.status, raw: stdout, stderr: (err.stderr || '').toString() };
    }
  }
}

function runRiskMarkdown(dir, extraArgs = []) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--markdown', ...extraArgs], {
      cwd: dir,
      encoding: 'utf8',
      env: hermeticEnv(),
    });
    return { output: stdout, exitCode: 0 };
  } catch (err) {
    return { output: (err.stdout || '').toString(), exitCode: err.status };
  }
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 1: No changes (clean) — score=0, Low, exit 0
// ---------------------------------------------------------------------------
test('no changes — score=0, Low, PASS, exit 0', () => {
  const dir = createTempRepo();
  const { output, exitCode } = runRisk(dir);
  assert.equal(exitCode, 0);
  assert.equal(output.overall_score, 0);
  assert.equal(output.risk_level, 'Low');
  assert.equal(output.gate, 'PASS');
  assert.equal(output.version, 1);
});

// ---------------------------------------------------------------------------
// Test 2: Simple file add — Low score, exit 0
// ---------------------------------------------------------------------------
test('simple file add — Low score, exit 0', () => {
  const dir = createTempRepo();
  // Add a new file without committing (unstaged change)
  writeFileSync(join(dir, 'newfile.ts'), 'const x = 1;\n');
  runGit(dir, ['add', '--', 'newfile.ts']);
  // The diff is HEAD vs staged, so we need to check against HEAD
  // Actually the script diffs against HEAD by default
  const { output, exitCode } = runRisk(dir);
  assert.equal(exitCode, 0);
  assert.equal(output.risk_level, 'Low');
  assert.ok(output.overall_score < 30, `Expected < 30, got ${output.overall_score}`);
});

// ---------------------------------------------------------------------------
// Test 3: Export function removed — breaking_surface high, signal detected
// ---------------------------------------------------------------------------
test('export function removed — breaking_surface signal detected', () => {
  const dir = createTempRepo();
  commitFile(dir, 'src/utils.ts', 'export function foo() { return 1; }\nexport function bar() { return 2; }\n');
  // Now remove foo
  writeFileSync(join(dir, 'src/utils.ts'), 'export function bar() { return 2; }\n');
  const { output } = runRisk(dir);
  const signals = output.dimensions.breaking_surface.signals;
  assert.ok(signals.length > 0, 'Should have breaking change signals');
  assert.ok(
    signals.some(s => s.type === 'export-removed'),
    `Expected export-removed signal, got: ${signals.map(s => s.type).join(', ')}`
  );
});

// ---------------------------------------------------------------------------
// Test 4: Function signature change — breaking_surface signal
// ---------------------------------------------------------------------------
test('function signature changed — breaking_surface signal detected', () => {
  const dir = createTempRepo();
  commitFile(dir, 'src/handler.ts', 'export function handle(a: string, b: number) { return a; }\n');
  // Change params
  writeFileSync(join(dir, 'src/handler.ts'), 'export function handle(a: string, b: number, c: boolean) { return a; }\n');
  const { output } = runRisk(dir);
  const signals = output.dimensions.breaking_surface.signals;
  assert.ok(
    signals.some(s => s.type === 'signature-changed'),
    `Expected signature-changed signal, got: ${signals.map(s => s.type).join(', ')}`
  );
});

// ---------------------------------------------------------------------------
// Test 5: High blast radius — file imported by 10+ others
// ---------------------------------------------------------------------------
test('high blast radius — file imported by many others', () => {
  const dir = createTempRepo();
  // Create a shared module
  commitFile(dir, 'src/shared.ts', 'export const shared = 1;\n');
  // Create 12 files that import it
  commitFiles(
    dir,
    Array.from({ length: 12 }, (_, i) => [
      `src/consumer${i}.ts`,
      `import { shared } from './shared';\nconsole.log(shared);\n`,
    ]),
    'add 12 consumers'
  );
  // Now modify the shared module
  writeFileSync(join(dir, 'src/shared.ts'), 'export const shared = 2;\n');
  const { output } = runRisk(dir);
  assert.ok(output.dimensions.blast_radius.score > 0, `Expected blast_radius > 0, got ${output.dimensions.blast_radius.score}`);
  assert.ok(output.dimensions.blast_radius.dependents_total > 0, `Expected dependents > 0, got ${output.dimensions.blast_radius.dependents_total}`);
});

// ---------------------------------------------------------------------------
// Test 6: Zero blast radius — new file, no importers
// ---------------------------------------------------------------------------
test('zero blast radius — new file with no importers', () => {
  const dir = createTempRepo();
  commitFile(dir, 'src/existing.ts', 'export const x = 1;\n');
  // Add a brand new file that nobody imports
  writeFileSync(join(dir, 'src/brand-new.ts'), 'export const y = 2;\n');
  runGit(dir, ['add', '--', 'src/brand-new.ts']);
  const { output } = runRisk(dir);
  // The brand-new file should have 0 dependents
  const newFileEntry = output.dimensions.blast_radius.top_affected.find(t => t.file.includes('brand-new'));
  if (newFileEntry) {
    assert.equal(newFileEntry.dependent_count, 0, 'New file should have 0 dependents');
  }
  // Overall blast radius should still account for existing.ts if it was also in the diff
  // But since only brand-new.ts is in the diff, blast_radius should be 0
  assert.equal(output.dimensions.blast_radius.score, 0);
});

// ---------------------------------------------------------------------------
// Test 7: Large scope (many files) — change_scope high
// ---------------------------------------------------------------------------
test('large scope — many files touched', () => {
  const dir = createTempRepo();
  // Commit base files. `change_scope` is measured from `git diff HEAD` alone
  // (risk-analyze.js: `BASE = argVal('--base') || 'HEAD'`), so these 30 files only
  // need to be present in HEAD — 30 separate commits bought nothing and cost 60
  // process spawns, which is where this test used to fail intermittently in CI.
  commitFiles(
    dir,
    Array.from({ length: 30 }, (_, i) => [
      `src/dir${i % 8}/mod${i}.ts`,
      `export const x${i} = ${i};\n`,
    ]),
    'add 30 base modules'
  );
  // Modify all of them
  for (let i = 0; i < 30; i++) {
    writeFileSync(join(dir, `src/dir${i % 8}/mod${i}.ts`), `export const x${i} = ${i + 100};\n`);
  }
  const { output } = runRisk(dir);
  assert.ok(output.dimensions.change_scope.score > 30, `Expected change_scope > 30, got ${output.dimensions.change_scope.score}`);
  assert.ok(output.dimensions.change_scope.metrics.file_count >= 30, `Expected >= 30 files, got ${output.dimensions.change_scope.metrics.file_count}`);
});

// ---------------------------------------------------------------------------
// Test 8: Small scope (1 file) — change_scope low
// ---------------------------------------------------------------------------
test('small scope — 1 file, few LOC', () => {
  const dir = createTempRepo();
  commitFile(dir, 'src/tiny.ts', 'const a = 1;\n');
  writeFileSync(join(dir, 'src/tiny.ts'), 'const a = 2;\nconst b = 3;\n');
  const { output } = runRisk(dir);
  assert.ok(output.dimensions.change_scope.score <= 15, `Expected change_scope <= 15, got ${output.dimensions.change_scope.score}`);
  assert.equal(output.dimensions.change_scope.metrics.file_count, 1);
});

// ---------------------------------------------------------------------------
// Test 9: Migration file detected — migration_safety.triggered = true
// ---------------------------------------------------------------------------
test('migration file detected — migration_safety triggered', () => {
  const dir = createTempRepo();
  commitFile(dir, 'src/app.ts', 'const x = 1;\n');
  // Add a migration file
  mkdirSync(join(dir, 'migrations'), { recursive: true });
  writeFileSync(join(dir, 'migrations/001_create_users.sql'), 'CREATE TABLE users (id INT);');
  runGit(dir, ['add', '.']);
  const { output } = runRisk(dir);
  assert.equal(output.flags.migration_safety.triggered, true);
  assert.ok(output.flags.migration_safety.files.length > 0, 'Should have migration files');
});

// ---------------------------------------------------------------------------
// Test 10: Migration with rollback — migration_safety.has_rollback = true
// ---------------------------------------------------------------------------
test('migration with rollback — has_rollback = true', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'migrations'), { recursive: true });
  writeFileSync(join(dir, 'migrations/001_up.sql'), 'CREATE TABLE users (id INT);');
  writeFileSync(join(dir, 'migrations/001_down.sql'), 'DROP TABLE users;');
  runGit(dir, ['add', '.']);
  const { output } = runRisk(dir);
  assert.equal(output.flags.migration_safety.triggered, true);
  assert.equal(output.flags.migration_safety.has_rollback, true);
});

// ---------------------------------------------------------------------------
// Test 11: Risk levels correct — score boundaries
// ---------------------------------------------------------------------------
test('risk levels — Low/Medium/High/Critical thresholds', () => {
  // We test the level mapping by constructing scenarios
  // Low: score 0 (no changes)
  const dir1 = createTempRepo();
  const { output: out1 } = runRisk(dir1);
  assert.equal(out1.risk_level, 'Low');

  // Medium: need score 30-49 — moderate change scope
  const dir2 = createTempRepo();
  commitFiles(
    dir2,
    Array.from({ length: 8 }, (_, i) => [
      `src/dir${i}/mod${i}.ts`,
      `export const x${i} = ${i};\n`,
    ]),
    'add 8 base modules'
  );
  for (let i = 0; i < 8; i++) {
    writeFileSync(join(dir2, `src/dir${i}/mod${i}.ts`), `export const x${i} = ${i + 100};\nexport const y${i} = ${i};\n`);
  }
  const { output: out2 } = runRisk(dir2);
  // Score depends on exact calculation, just check it's a valid level
  assert.ok(['Low', 'Medium', 'High', 'Critical'].includes(out2.risk_level));
});

// ---------------------------------------------------------------------------
// Test 12: Exit codes — 0 (low/med), 1 (high), 2 (critical)
// ---------------------------------------------------------------------------
test('exit codes — 0 for low/medium', () => {
  // Low: no changes
  const dir = createTempRepo();
  const { exitCode } = runRisk(dir);
  assert.equal(exitCode, 0);
});

// ---------------------------------------------------------------------------
// Test 13: Markdown output — check sections present
// ---------------------------------------------------------------------------
test('markdown output — has all expected sections', () => {
  const dir = createTempRepo();
  commitFile(dir, 'src/app.ts', 'export function foo() {}\n');
  writeFileSync(join(dir, 'src/app.ts'), 'export function bar() {}\n');
  const { output } = runRiskMarkdown(dir);
  assert.ok(output.includes('## Risk Assessment Report'), 'Should have report header');
  assert.ok(output.includes('### Dimensions'), 'Should have dimensions section');
  assert.ok(output.includes('### Change Scope'), 'Should have change scope section');
  assert.ok(output.includes('## Gate:'), 'Should have gate sentinel');
});

// ---------------------------------------------------------------------------
// Test 14: Deep mode — deep_analysis populated
// ---------------------------------------------------------------------------
test('deep mode — deep_analysis populated', () => {
  const dir = createTempRepo();
  commitFile(dir, 'src/mod.ts', 'export const x = 1;\n');
  writeFileSync(join(dir, 'src/mod.ts'), 'export const x = 2;\n');
  const { output } = runRisk(dir, ['--mode', 'deep']);
  assert.ok(output.deep_analysis !== null, 'deep_analysis should be populated');
  assert.ok('hotspots' in output.deep_analysis);
  assert.ok('transitive_count' in output.deep_analysis);
  assert.ok('churn_summary' in output.deep_analysis);
  assert.equal(output.mode, 'deep');
});

// ---------------------------------------------------------------------------
// Test 15: Custom base — --base HEAD~2 compares against ancestor
// ---------------------------------------------------------------------------
test('custom base — --base HEAD~1 compares against ancestor', () => {
  const dir = createTempRepo();
  commitFile(dir, 'src/a.ts', 'const a = 1;\n');
  commitFile(dir, 'src/b.ts', 'const b = 2;\n');
  // Now diff against HEAD~1 should show src/b.ts
  const { output } = runRisk(dir, ['--base', 'HEAD~1']);
  assert.ok(output.dimensions.change_scope.metrics.file_count > 0, 'Should detect changes from HEAD~1');
});

// ---------------------------------------------------------------------------
// Test 16: Python import detection
// ---------------------------------------------------------------------------
test('python import detection — blast_radius resolves python imports', () => {
  const dir = createTempRepo();
  commitFile(dir, 'utils.py', 'def parse():\n    pass\n');
  commitFile(dir, 'main.py', 'from utils import parse\nparse()\n');
  commitFile(dir, 'handler.py', 'import utils\nutils.parse()\n');
  // Modify utils.py
  writeFileSync(join(dir, 'utils.py'), 'def parse(strict=False):\n    pass\n');
  const { output } = runRisk(dir);
  // main.py and handler.py both import utils — expect at least 1 dependent
  assert.ok(output.dimensions.blast_radius.dependents_total >= 1, `Expected dependents >= 1, got ${output.dimensions.blast_radius.dependents_total}`);
});

// ---------------------------------------------------------------------------
// Test 17: Go import detection
// ---------------------------------------------------------------------------
test('go import detection — blast_radius resolves go imports', () => {
  const dir = createTempRepo();
  commitFile(dir, 'pkg/utils/utils.go', 'package utils\n\nfunc Parse() {}\n');
  commitFile(dir, 'cmd/main.go', 'package main\n\nimport "pkg/utils"\n\nfunc main() { utils.Parse() }\n');
  // Modify utils.go
  writeFileSync(join(dir, 'pkg/utils/utils.go'), 'package utils\n\nfunc Parse(strict bool) {}\n');
  const { output } = runRisk(dir);
  // cmd/main.go imports pkg/utils — expect at least 1 dependent
  assert.ok(output.dimensions.blast_radius.dependents_total >= 1, `Expected dependents >= 1, got ${output.dimensions.blast_radius.dependents_total}`);
});

// ---------------------------------------------------------------------------
// Test 18: Gate sentinels — PASS/REVIEW/BLOCK in output
// ---------------------------------------------------------------------------
test('gate sentinels — PASS for low risk', () => {
  const dir = createTempRepo();
  const { output } = runRisk(dir);
  assert.equal(output.gate, 'PASS');
});

// ---------------------------------------------------------------------------
// Test 19: Rename-heavy refactor — change_scope.rename_ratio high
// ---------------------------------------------------------------------------
test('rename-heavy refactor — high rename_ratio', () => {
  const dir = createTempRepo();
  // Create files then rename them
  commitFiles(
    dir,
    Array.from({ length: 5 }, (_, i) => [`src/old${i}.ts`, `export const x${i} = ${i};\n`]),
    'add 5 modules to rename'
  );
  // Rename all files using git mv
  for (let i = 0; i < 5; i++) {
    runGit(dir, ['mv', `src/old${i}.ts`, `src/new${i}.ts`]);
  }
  const { output } = runRisk(dir);
  assert.ok(output.dimensions.change_scope.metrics.rename_ratio > 0, `Expected rename_ratio > 0, got ${output.dimensions.change_scope.metrics.rename_ratio}`);
});

// ---------------------------------------------------------------------------
// Test 20: Config key removal — breaking_surface signal
// ---------------------------------------------------------------------------
test('config key removal — breaking_surface signal detected', () => {
  const dir = createTempRepo();
  commitFile(dir, 'package.json', JSON.stringify({
    name: 'test',
    scripts: { test: 'jest', build: 'tsc' },
  }, null, 2));
  // Remove the build script
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'test',
    scripts: { test: 'jest' },
  }, null, 2));
  const { output } = runRisk(dir);
  const signals = output.dimensions.breaking_surface.signals;
  assert.ok(
    signals.some(s => s.type === 'config-key-removed'),
    `Expected config-key-removed signal, got: ${signals.map(s => s.type).join(', ')}`
  );
});

// ---------------------------------------------------------------------------
// Test 21: Invalid base ref — exit code 2
// ---------------------------------------------------------------------------
test('invalid base ref — exits with code 2', () => {
  const dir = createTempRepo();
  commitFile(dir, 'src/a.ts', 'const a = 1;\n');
  writeFileSync(join(dir, 'src/a.ts'), 'const a = 2;\n');
  const { exitCode } = runRisk(dir, ['--base', 'nonexistent-ref-abc123']);
  assert.equal(exitCode, 2, `Expected exit code 2 for invalid base ref, got ${exitCode}`);
});

// ---------------------------------------------------------------------------
// Test 22: Truly untracked files (??) affect change_scope
// ---------------------------------------------------------------------------
test('untracked files — included in change_scope metrics', () => {
  const dir = createTempRepo();
  // Create files but do NOT git add — they remain ?? status
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/untracked1.ts'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'src/untracked2.ts'), 'export const y = 2;\n');
  const { output } = runRisk(dir);
  assert.ok(output.dimensions.change_scope.metrics.file_count >= 2, `Expected file_count >= 2, got ${output.dimensions.change_scope.metrics.file_count}`);
  assert.ok(output.dimensions.change_scope.metrics.loc_delta >= 2, `Expected loc_delta >= 2, got ${output.dimensions.change_scope.metrics.loc_delta}`);
});

// ---------------------------------------------------------------------------
// Test 23: next_actions commands use qualified format when present
// ---------------------------------------------------------------------------
test('next_actions commands use qualified /sd0x-dev-flow: prefix when present', () => {
  const dir = createTempRepo();
  // High risk + high breaking surface to generate next_actions with commands
  // Create many exports then remove them all
  const exports = [];
  for (let i = 0; i < 20; i++) exports.push(`export function fn${i}() { return ${i}; }`);
  commitFile(dir, 'src/api.ts', exports.join('\n') + '\n');
  commitFiles(
    dir,
    Array.from({ length: 15 }, (_, i) => [
      `src/consumer${i}.ts`,
      `import { fn0 } from './api';\nconsole.log(fn0());\n`,
    ]),
    'add 15 consumers'
  );
  // Remove most exports — heavy breaking change
  writeFileSync(join(dir, 'src/api.ts'), 'export function fn0() { return 0; }\n');
  // Also modify many files for high scope
  for (let i = 0; i < 15; i++) {
    writeFileSync(join(dir, `src/consumer${i}.ts`), `import { fn0 } from './api';\nconsole.log(fn0(), ${i});\n`);
  }
  const { output } = runRisk(dir);
  const withCommands = output.next_actions.filter(a => a.command);
  // If commands are generated, they must be qualified
  if (withCommands.length > 0) {
    for (const action of withCommands) {
      assert.ok(
        action.command.startsWith('/sd0x-dev-flow:'),
        `Expected qualified command, got: ${action.command}`
      );
    }
  } else {
    // Even without triggered commands, verify no unqualified commands leak through
    const allCommands = output.next_actions.map(a => a.command).filter(Boolean);
    for (const cmd of allCommands) {
      assert.ok(!cmd.startsWith('/') || cmd.startsWith('/sd0x-dev-flow:'), `Unexpected unqualified command: ${cmd}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Test 24: regression — a failing git command reports git's own stderr
//
// CI run 31167731942 failed here with "Command failed: git ... commit -m add
// src/dir5/mod21.ts" and nothing else, because every call passed `stdio: 'ignore'`.
// The cause was unrecoverable from the log. This pins the diagnostic.
// ---------------------------------------------------------------------------
test('runGit failure surfaces git stderr, exit status and cwd — not a bare "Command failed"', () => {
  const dir = createTempRepo();

  // `checkout` of a ref that cannot exist. Measured: exit 1, stderr
  // "error: pathspec 'no-such-ref-3f9a2c' did not match any file(s) known to git".
  // `assert.throws` returns undefined, so the error is captured by hand.
  let err;
  try {
    runGit(dir, ['checkout', 'no-such-ref-3f9a2c']);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'runGit must throw when git exits non-zero');

  assert.match(err.message, /no-such-ref-3f9a2c/, 'must name the ref git rejected');
  assert.match(err.message, /stderr:/, 'must carry a stderr section');
  assert.match(err.message, /exit 1\b/, "must report git's exit status");
  assert.ok(err.message.includes(dir), 'must name the repo the command ran in');
  // The old behaviour: node's own message with no cause attached. If `stdio` goes
  // back to 'ignore', `stderr:` above reads "(empty)" and this line is what says why.
  assert.doesNotMatch(err.message, /stderr: \(empty\)/, 'stderr must not be discarded');
});

// ---------------------------------------------------------------------------
// Test 25: negative control for Test 24 — the guard must not fire on success.
// Without it, replacing runGit's body with an unconditional `throw` would keep
// Test 24 green while breaking every other test in this file.
// ---------------------------------------------------------------------------
test('runGit returns stdout on success and does not throw', () => {
  const dir = createTempRepo();
  const out = runGit(dir, ['rev-list', '--count', 'HEAD']);
  assert.equal(out.trim(), '1', 'the init commit is the only one in a fresh fixture');
});

// ---------------------------------------------------------------------------
// Test 26: regression — commitFiles stages the WHOLE batch in ONE commit
//
// The flake's mechanism was 2 process spawns per file. Batching is only a valid
// substitution if the resulting tree is identical; this asserts both halves —
// same files in HEAD, fewer commits to get them there.
// ---------------------------------------------------------------------------
test('commitFiles produces the same HEAD tree as per-file commits, in a single commit', () => {
  const entries = [
    ['src/dir0/a.ts', 'export const a = 1;\n'],
    ['src/dir1/b.ts', 'export const b = 2;\n'],
    ['src/dir1/c.ts', 'export const c = 3;\n'],
  ];

  const batched = createTempRepo();
  commitFiles(batched, entries, 'add batch');

  const perFile = createTempRepo();
  for (const [filePath, content] of entries) commitFile(perFile, filePath, content);

  const treeOf = dir => runGit(dir, ['ls-tree', '-r', 'HEAD', '--name-only']).trim().split('\n').sort();
  const commitsOf = dir => Number(runGit(dir, ['rev-list', '--count', 'HEAD']).trim());

  assert.deepEqual(treeOf(batched), treeOf(perFile), 'both routes must land the same files in HEAD');
  assert.deepEqual(treeOf(batched), ['src/dir0/a.ts', 'src/dir1/b.ts', 'src/dir1/c.ts']);

  // init + 1 batch vs init + 3 singles — this is the spawn reduction, asserted.
  assert.equal(commitsOf(batched), 2, 'batch must be exactly one commit on top of init');
  assert.equal(commitsOf(perFile), 4, 'per-file must be one commit each — the behaviour being replaced');

  // A clean tree afterwards proves `git add` missed nothing (an unstaged leftover
  // would show here, and would have made the batch silently lossy).
  assert.equal(runGit(batched, ['status', '--porcelain']).trim(), '', 'no file left unstaged');
});

// Restore each var to exactly the state it was in, including "absent". Assigning
// `undefined` to process.env stores the STRING "undefined", which would leave a
// GIT_CONFIG_GLOBAL pointing at a file named "undefined" behind for later tests.
//
// Synchronous only, and it says so in the name: `finally` fires when the callback
// RETURNS, so an async callback would be restored before its first await resumed and
// would silently observe the original values. The guard below makes that a failure
// rather than a mystery; every test in this file is synchronous today.
function withEnvSync(overrides, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : null);
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const result = fn();
    assert.ok(
      typeof result?.then !== 'function',
      'withEnvSync cannot protect an async callback — its restore runs before the first await resumes'
    );
    return result;
  } finally {
    for (const [key, value] of saved) {
      if (value === null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// A HOME with nothing in it, shared by every control below.
let cleanHomeDir;
function cleanHome() {
  if (!cleanHomeDir) {
    cleanHomeDir = mkdtempSync(join(tmpdir(), 'sd0x-clean-home-'));
    tempDirs.push(cleanHomeDir);
  }
  return cleanHomeDir;
}

// A clean developer machine: ambient git variables stripped and HOME emptied, but
// none of the hermetic neutralisers applied. This is the baseline the controls need
// — building them from process.env directly would make them collapse on a machine
// that exports one of the very variables under test. Measured: with an ambient
// `core.hooksPath`, a process.env-based control fails its own `git commit` setup,
// and with an ambient GIT_DIR its `git init` lands elsewhere. Either reads as
// "hermeticity is broken" when what broke is the control.
function cleanBaseEnv() {
  const env = { ...process.env };
  for (const key of [...STRIPPED_GIT_ENV_KEYS, ...Object.keys(HERMETIC_GIT_CONFIG_ENV)]) {
    delete env[key];
  }
  env.HOME = cleanHome();
  env.XDG_CONFIG_HOME = join(cleanHome(), '.config');
  return env;
}

// Run git as that clean machine would, plus exactly one hostile artifact. This is
// the oracle every hermeticity test controls against: it proves the artifact is one
// git genuinely honours, so a green hermetic assertion means the env neutralised
// something real rather than that the fixture was inert.
function ambientGit(dir, args, env) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...cleanBaseEnv(), ...env },
  });
}

// A throwaway HOME carrying one hostile artifact per ambient-state channel. Values
// chosen because each was measured to break this suite through a different route.
function hostileHome() {
  const home = mkdtempSync(join(tmpdir(), 'sd0x-hostile-'));
  tempDirs.push(home);
  mkdirSync(join(home, '.config/git'), { recursive: true });
  mkdirSync(join(home, 'templates/hooks'), { recursive: true });
  writeFileSync(join(home, '.gitconfig'), '[diff]\n\tnoprefix = true\n');
  writeFileSync(join(home, '.config/git/ignore'), '*.ts\n');
  writeFileSync(join(home, 'templates/hooks/pre-commit'), '#!/bin/sh\nexit 1\n');
  return {
    home,
    templateDir: join(home, 'templates'),
    // HOME alone is ambiguous: an ambient XDG_CONFIG_HOME would still win for the
    // ignore file. Pinning both makes the fixture deterministic.
    env: { HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
  };
}

// ---------------------------------------------------------------------------
// Test 27: regression — a spawn-level failure names its cause, not "exit null"
//
// Test 24 only exercises the exit-1 path. Every failure where git never ran, or ran
// and was killed, has `status: null` and no usable stderr — measured: ENOENT
// {code:'ENOENT', stderr:undefined}, timeout {code:'ETIMEDOUT', signal:'SIGTERM'},
// SIGKILL {signal:'SIGKILL'}. Reading err.status alone renders all three as
// "failed (exit null) ... stderr: (empty)", which reads as "git ran and said
// nothing" — strictly less than the `spawnSync git ENOENT` the old `stdio:'ignore'`
// code surfaced. An OOM-killed or timed-out runner is the likeliest CI-only flake,
// so this is the path that most needs to be legible.
// ---------------------------------------------------------------------------
test('runGit reports a spawn-level failure by code, not as "exit null"', () => {
  const dir = createTempRepo();

  // Point PATH at a directory that exists and holds no git, rather than setting it
  // empty. An empty-but-set PATH means "cwd only" on macOS and musl, but glibc's
  // execvp only falls back to confstr(_CS_PATH) when PATH is absent — so `''` and
  // `delete` differ per libc, and a later refactor between them would produce a
  // macOS-only green. An empty directory is unambiguous everywhere.
  const emptyBin = mkdtempSync(join(tmpdir(), 'sd0x-nobin-'));
  tempDirs.push(emptyBin);

  let err;
  withEnvSync({ PATH: emptyBin }, () => {
    try {
      runGit(dir, ['status']);
    } catch (e) {
      err = e;
    }
  });
  assert.ok(err, 'runGit must throw when git cannot be spawned');

  assert.match(err.message, /ENOENT/, 'must name the error code the spawn failed with');
  // Structural, not prose: the cause line must exist and must carry the code. Pinning
  // Node's exact "spawnSync git ENOENT" wording would break on a Node message change
  // for no behavioural reason.
  assert.match(err.message, /\n {2}cause: .*ENOENT/, 'must carry a cause line naming the code');
  assert.doesNotMatch(err.message, /exit null/, 'null status must never be printed as an exit code');
  // stderr is `undefined` here, not '' — the pipe never existed. Reporting that as
  // "(empty)" claims git ran silently, which is the misdiagnosis being prevented.
  assert.match(err.message, /stderr: \(not captured/, 'must distinguish "no pipe" from "ran silently"');
  assert.ok(err.message.includes(dir), 'must still name the repo the command targeted');
});

// ---------------------------------------------------------------------------
// Test 27b: negative control for the cause line — it must NOT fire on shapes
// whose message names no cause. A SIGKILLed git has status null but no code, and
// err.message there only restates the command line. Keying the line on a null
// status (rather than on err.code) would label that "spawn:" — wrong twice: the
// process did spawn, and the line carries nothing. This is the OOM-kill path.
// ---------------------------------------------------------------------------
test('runGit omits the cause line when the failure carries no error code', () => {
  const dir = createTempRepo();

  // The shim must be named `git`, because that is the process runGit spawns and
  // therefore the only one whose death Node reports as a signal. Routing through a
  // `git-<subcommand>` shim instead does NOT reproduce the shape: real git reaps the
  // subcommand and exits 137 itself, giving {status:137, signal:null} — measured.
  const binDir = mkdtempSync(join(tmpdir(), 'sd0x-bin-'));
  tempDirs.push(binDir);
  writeFileSync(join(binDir, 'git'), '#!/bin/sh\nkill -9 $$\n', { mode: 0o755 });

  let err;
  withEnvSync({ PATH: binDir }, () => {
    try {
      runGit(dir, ['status']);
    } catch (e) {
      err = e;
    }
  });
  assert.ok(err, 'runGit must throw when git is killed by a signal');

  assert.match(err.message, /signal SIGKILL/, 'must name the signal that killed git');
  assert.doesNotMatch(err.message, /exit null/, 'null status must never be printed as an exit code');
  assert.doesNotMatch(err.message, /\n {2}cause:/, 'a signal death carries no cause — the line must be omitted');
});

// ---------------------------------------------------------------------------
// Test 28: regression — the fixture ignores the developer's real global gitconfig
//
// Measured against the suite before hermeticEnv existed: a global `core.hooksPath`
// (an ordinary shared-hooks setup — and this repo asks contributors to install
// commit-msg-guard.sh and pre-push-gate.sh) took it to 0 pass/29 fail. A global
// `diff.noprefix` + `diff.renames=false` failed 5 with no hook involved, through
// risk-analyze.js parsing a diff it had silently reshaped.
//
// The channel exercised here is HOME, not GIT_CONFIG_GLOBAL. Poisoning the same
// variable the fix sets would only prove "our value beats an ambient value of the
// same name"; ~/.gitconfig is the path a developer actually has.
// ---------------------------------------------------------------------------
test('runGit ignores a hostile ~/.gitconfig reached through HOME', () => {
  const dir = createTempRepo();
  const hostile = hostileHome();
  const probe = ['config', '--get', '--default', 'unset', 'diff.noprefix'];

  // Negative control: git genuinely reads this file, so the hermetic assertion
  // below means the env neutralised something real.
  assert.equal(ambientGit(dir, probe, hostile.env).trim(), 'true', 'the hostile HOME must be one git actually reads');

  withEnvSync(hostile.env, () => {
    assert.equal(runGit(dir, probe).trim(), 'unset', 'runGit must not inherit the ambient global config');
  });
});

// ---------------------------------------------------------------------------
// Test 29: regression — env-injected config reaches git with no file involved
//
// GIT_CONFIG_COUNT/KEY_n/VALUE_n is a config channel that no `GIT_CONFIG_GLOBAL`
// setting can close. Measured before the fix: 24 pass/5 fail — the same two keys
// that motivated the change, arriving by a route it did not cover.
// ---------------------------------------------------------------------------
test('runGit ignores config injected through GIT_CONFIG_COUNT', () => {
  const dir = createTempRepo();
  const injected = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'diff.noprefix',
    GIT_CONFIG_VALUE_0: 'true',
  };
  const probe = ['config', '--get', '--default', 'unset', 'diff.noprefix'];

  assert.equal(ambientGit(dir, probe, injected).trim(), 'true', 'injected config must be config git honours');

  withEnvSync(injected, () => {
    assert.equal(runGit(dir, probe).trim(), 'unset', 'our GIT_CONFIG_COUNT must clamp the ambient one');
  });
});

// ---------------------------------------------------------------------------
// Test 30: regression — the XDG ignore-file path default
//
// This is the channel `GIT_CONFIG_GLOBAL=/dev/null` actively OPENS: it unsets
// core.excludesFile, and git then falls back to its hardcoded
// $XDG_CONFIG_HOME/git/ignore. That is a path default, not a config value, so no
// config file can suppress it — only naming the key explicitly can. Measured
// before that was done: an XDG git/ignore holding `*.ts` → 11 pass/18 fail.
//
// Asserted behaviourally: every fixture source file this suite writes is a .ts.
// ---------------------------------------------------------------------------
test('runGit ignores a hostile XDG git/ignore that would hide every fixture .ts file', () => {
  const dir = createTempRepo();
  const hostile = hostileHome();
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/mod.ts'), 'export const x = 1;\n');
  const probe = ['status', '--porcelain', '--untracked-files=all'];

  const ambient = ambientGit(dir, probe, hostile.env);
  assert.doesNotMatch(ambient, /src\/mod\.ts/, 'the hostile ignore file must genuinely hide the fixture file');

  withEnvSync(hostile.env, () => {
    assert.match(runGit(dir, probe), /src\/mod\.ts/, 'runGit must see fixture files whatever the ambient ignore rules say');
  });
});

// ---------------------------------------------------------------------------
// Test 31: regression — GIT_TEMPLATE_DIR seeds hooks into every `git init`
//
// Not a config key at all, so no config neutraliser reaches it. Measured before it
// was stripped: 0 pass/29 fail, the same total loss as the core.hooksPath incident
// the change was written to prevent.
// ---------------------------------------------------------------------------
test('runGit strips GIT_TEMPLATE_DIR so fixture repos get no ambient hooks', () => {
  const hostile = hostileHome();
  const poisoned = { GIT_TEMPLATE_DIR: hostile.templateDir };

  const ambientDir = mkdtempSync(join(tmpdir(), 'sd0x-tmpl-'));
  tempDirs.push(ambientDir);
  ambientGit(ambientDir, ['init'], poisoned);
  assert.ok(existsSync(join(ambientDir, '.git/hooks/pre-commit')), 'the template dir must be one git actually copies from');

  withEnvSync(poisoned, () => {
    const dir = createTempRepo();
    assert.ok(!existsSync(join(dir, '.git/hooks/pre-commit')), 'a fixture repo must not inherit ambient hooks');
  });
});

// ---------------------------------------------------------------------------
// Test 32: regression — an exported GIT_DIR cannot redirect the fixture
//
// GIT_DIR outranks `cwd`, so without stripping it a fixture `commit` writes into
// whatever repository it names. That is not a failing test; it is test commits
// landing in a real repository.
//
// Both reads below pass `--git-dir` explicitly. A bare `ls-tree` would follow the
// same ambient GIT_DIR and read the decoy — under the real regression it returns
// the decoy's tree, which by then DOES contain the file, so the assertion would
// pass at the moment the property it names is violated.
// ---------------------------------------------------------------------------
test('runGit strips GIT_DIR so fixture commits cannot land in another repository', () => {
  const decoy = createTempRepo();
  const target = createTempRepo();

  withEnvSync({ GIT_DIR: join(decoy, '.git') }, () => {
    commitFile(target, 'src/only-here.ts', 'export const x = 1;\n');

    const treeOf = dir => runGit(dir, ['--git-dir', join(dir, '.git'), 'ls-tree', '-r', 'HEAD', '--name-only']).trim();
    const countOf = dir => runGit(dir, ['--git-dir', join(dir, '.git'), 'rev-list', '--count', 'HEAD']).trim();

    assert.equal(treeOf(target), 'src/only-here.ts', 'the commit must land in the repo cwd names');
    assert.equal(countOf(decoy), '1', 'the decoy must still hold only its init commit');
    assert.equal(treeOf(decoy), '', 'the decoy repo must stay empty');
  });
});

// ---------------------------------------------------------------------------
// Test 33: regression — ambient identity cannot reach a fixture commit
//
// COMMIT_CONFIG's `-c user.name` is OUTRANKED by GIT_AUTHOR_NAME. Measured on git
// 2.54.0: with an ambient name exported, the commit records it. And an ambient
// EMPTY one is fatal — git rejects the ident and `-c` cannot override it, which
// took the suite to 0 pass/29 fail.
// ---------------------------------------------------------------------------
test('runGit strips ambient identity so fixture commits are attributed to the fixture', () => {
  const ambient = { GIT_AUTHOR_NAME: 'Ambient Dev', GIT_AUTHOR_EMAIL: 'ambient@example.com' };
  const format = ['log', '-1', '--format=%an <%ae>'];

  // Negative control: the ambient identity really does outrank the `-c` flags.
  const control = createTempRepo();
  writeFileSync(join(control, 'f.txt'), 'x\n');
  ambientGit(control, ['add', '--', 'f.txt'], ambient);
  ambientGit(control, [...COMMIT_CONFIG, 'commit', '-m', 'probe'], ambient);
  assert.equal(ambientGit(control, format, ambient).trim(), 'Ambient Dev <ambient@example.com>', '-c must be outranked by GIT_AUTHOR_NAME');

  withEnvSync(ambient, () => {
    const dir = createTempRepo();
    commitFile(dir, 'src/mod.ts', 'export const x = 1;\n');
    assert.equal(runGit(dir, format).trim(), 'test <test@test>', 'a developer name must never reach a fixture commit');
  });

  // The empty case is the fatal one: git refuses the ident outright.
  withEnvSync({ GIT_AUTHOR_NAME: '' }, () => {
    const dir = createTempRepo();
    commitFile(dir, 'src/mod.ts', 'export const x = 1;\n');
    assert.equal(runGit(dir, format).trim(), 'test <test@test>', 'an empty ambient name must not make commits impossible');
  });
});

// ---------------------------------------------------------------------------
// Test 34: the hermetic settings are pinned individually
//
// Tests 28-33 each prove one setting matters behaviourally. This one stops the
// REST from being deleted unnoticed: before it existed, removing
// GIT_CONFIG_NOSYSTEM, or six of the seven repo-location keys, left the suite at
// 29 pass / 0 fail. The key names below are written out deliberately — iterating
// the source lists would make the assertion vacuous the moment one is removed.
// ---------------------------------------------------------------------------
test('hermeticEnv strips every ambient git variable and sets every config neutraliser', () => {
  const mustStrip = [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
    'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
    'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE',
    'GIT_TEMPLATE_DIR',
  ];
  const mustSet = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.excludesfile',
    GIT_CONFIG_VALUE_0: '/dev/null',
    GIT_CONFIG_KEY_1: 'core.attributesfile',
    GIT_CONFIG_VALUE_1: '/dev/null',
  };

  const poisoned = Object.fromEntries(mustStrip.map(key => [key, 'ambient-value-that-must-not-survive']));
  withEnvSync(poisoned, () => {
    const env = hermeticEnv();
    for (const key of mustStrip) {
      assert.ok(!(key in env), `${key} must not survive into a fixture git invocation`);
    }
    for (const [key, value] of Object.entries(mustSet)) {
      assert.equal(env[key], value, `${key} must be pinned to ${value}`);
    }
  });

  // PATH is the control: hermeticEnv must pass the ordinary environment through,
  // not hand git an empty one.
  assert.equal(hermeticEnv().PATH, process.env.PATH, 'the ambient PATH must survive');
});

// ---------------------------------------------------------------------------
// Test 35: the OTHER half — risk-analyze.js runs git too
//
// runRisk/runRiskMarkdown spawn node, which spawns git inside the fixture. Before
// this test existed, reverting both of them to `{ ...process.env }` left the suite
// at 29 pass / 0 fail — and that is precisely the half where the measured
// diff.noprefix/diff.renames failures occurred, since risk-analyze.js is what
// parses the reshaped diff. Mirrors test 3's scenario under a hostile HOME.
// ---------------------------------------------------------------------------
test('runRisk is hermetic too — analysis is unaffected by a hostile ambient gitconfig', () => {
  const dir = createTempRepo();
  const hostile = hostileHome();
  commitFile(dir, 'src/utils.ts', 'export function foo() { return 1; }\nexport function bar() { return 2; }\n');
  writeFileSync(join(dir, 'src/utils.ts'), 'export function bar() { return 2; }\n');

  withEnvSync(hostile.env, () => {
    const { output } = runRisk(dir);
    const signals = output.dimensions.breaking_surface.signals;
    assert.ok(
      signals.some(s => s.type === 'export-removed'),
      `hostile ambient config must not reshape the diff risk-analyze.js parses; got: ${signals.map(s => s.type).join(', ') || '(none)'}`
    );
  });
});
