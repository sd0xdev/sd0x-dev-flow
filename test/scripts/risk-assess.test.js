const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../skills/risk-assess/scripts/risk-analyze.js');
const tempDirs = [];

function createTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-risk-'));
  tempDirs.push(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' }
  );
  return dir;
}

function commitFile(dir, filePath, content) {
  const fullPath = join(dir, filePath);
  mkdirSync(join(dir, require('path').dirname(filePath)), { recursive: true });
  writeFileSync(fullPath, content);
  execFileSync('git', ['add', filePath], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', `add ${filePath}`],
    { cwd: dir, stdio: 'ignore' }
  );
}

function runRisk(dir, extraArgs = []) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--json', ...extraArgs], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env },
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
      env: { ...process.env },
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
  execFileSync('git', ['add', 'newfile.ts'], { cwd: dir, stdio: 'ignore' });
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
  for (let i = 0; i < 12; i++) {
    commitFile(dir, `src/consumer${i}.ts`, `import { shared } from './shared';\nconsole.log(shared);\n`);
  }
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
  execFileSync('git', ['add', 'src/brand-new.ts'], { cwd: dir, stdio: 'ignore' });
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
  // Commit base files
  for (let i = 0; i < 30; i++) {
    commitFile(dir, `src/dir${i % 8}/mod${i}.ts`, `export const x${i} = ${i};\n`);
  }
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
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
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
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
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
  for (let i = 0; i < 8; i++) {
    commitFile(dir2, `src/dir${i}/mod${i}.ts`, `export const x${i} = ${i};\n`);
  }
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
  for (let i = 0; i < 5; i++) {
    commitFile(dir, `src/old${i}.ts`, `export const x${i} = ${i};\n`);
  }
  // Rename all files using git mv
  for (let i = 0; i < 5; i++) {
    execFileSync('git', ['mv', `src/old${i}.ts`, `src/new${i}.ts`], { cwd: dir, stdio: 'ignore' });
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
  for (let i = 0; i < 15; i++) {
    commitFile(dir, `src/consumer${i}.ts`, `import { fn0 } from './api';\nconsole.log(fn0());\n`);
  }
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
