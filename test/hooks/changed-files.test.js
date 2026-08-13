const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
  existsSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const editHookPath = resolve(__dirname, '../../hooks/post-edit-format.sh');
const reviewHookPath = resolve(__dirname, '../../hooks/post-tool-review-state.sh');
const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

// jq stub: supports the full path exercised by edit-hook + review-hook, with
// dedicated handlers for the D-3 filters (changed_files_since_review track/reset).
// Ported from test/hooks/post-tool-review-state.test.js with additions for the
// _track_changed_file filter shape `(old // []) + [$f] | unique`.
function jqStubSource(opts = {}) {
  const trackMode = opts.trackMode || 'normal'; // 'normal' | 'writes-short'
  return `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
let query, file;
const vars = {};
let hasExitFlag = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-r') continue;
  if (arg === '-e') { hasExitFlag = true; continue; }
  if (arg === '--arg') { vars[args[i + 1]] = args[i + 2]; i += 2; continue; }
  if (arg === '--argjson') {
    const key = args[i + 1];
    const val = args[i + 2];
    try { vars[key] = JSON.parse(val); } catch {
      if (val === 'true') vars[key] = true;
      else if (val === 'false') vars[key] = false;
      else vars[key] = val;
    }
    i += 2; continue;
  }
  if (!query) { query = arg; continue; }
  if (!file) { file = arg; continue; }
}
let input = '';
try { input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8'); } catch {}
let data = {};
try { data = input ? JSON.parse(input) : {}; } catch {}

function asBoolString(v) { return v === true || v === 'true' ? 'true' : 'false'; }

// ---- D-3 filters under test ----
if (query && query.includes('.changed_files_since_review = []')) {
  data.changed_files_since_review = [];
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('changed_files_since_review') && query.includes('unique') && vars.f) {
  ${trackMode === 'writes-short'
    ? "process.stdout.write('{}'); process.exit(0);"
    : `const existing = data.changed_files_since_review || [];
  const merged = existing.slice();
  if (!merged.includes(vars.f)) merged.push(vars.f);
  data.changed_files_since_review = merged;
  process.stdout.write(JSON.stringify(data));
  process.exit(0);`}
}

// ---- Read filters over stdin ----
// notebook_path coalesce mirrors the real hook jq fallback (file_path // notebook_path)
// so NotebookEdit events resolve a path through this mock just like production.
if (query && query.includes('.tool_input.file_path')) {
  const ti = data.tool_input || {};
  const val = ti.file_path || (query.includes('notebook_path') ? ti.notebook_path : '') || '';
  process.stdout.write(val);
  process.exit(0);
}
if (query && (query.includes('.tool_name') || query.includes('.tool_input') || query.includes('.tool_output') || query.includes('.transcript_path') || query.includes('.command'))) {
  if (query.includes('.tool_name')) { process.stdout.write(data.tool_name || ''); process.exit(0); }
  if (query.includes('.transcript_path')) { process.stdout.write(data.transcript_path || ''); process.exit(0); }
  if (query.includes('.command')) { process.stdout.write(data.command || ''); process.exit(0); }
  if (query.includes('tool_output') && query.includes('type') && query.includes('content')) {
    const to = data.tool_output;
    if (to && typeof to === 'object' && !Array.isArray(to)) {
      const c = to.content;
      if (typeof c === 'string') process.stdout.write(c);
      else if (Array.isArray(c)) process.stdout.write(c.filter(x => x.type === 'text').map(x => x.text).join('\\n'));
      else process.stdout.write(JSON.stringify(to));
    } else if (typeof to === 'string') process.stdout.write(to);
    else process.stdout.write('');
    process.exit(0);
  }
  if (query.includes('.tool_input.command')) { process.stdout.write((data.tool_input && data.tool_input.command) || ''); process.exit(0); }
  if (query.includes('.tool_input')) {
    const val = data.tool_input;
    process.stdout.write(val === undefined ? '' : (typeof val === 'string' ? val : JSON.stringify(val)));
    process.exit(0);
  }
  if (query.includes('.tool_output')) {
    const val = data.tool_output;
    process.stdout.write(val === undefined ? '' : (typeof val === 'string' ? val : JSON.stringify(val)));
    process.exit(0);
  }
}

// ---- Flag/merge filters (edit hook) ----
if (query && query.includes('[$flag]') && vars.flag) {
  data[vars.flag] = true;
  data.updated_at = vars.now || '';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('has_doc_change = true')) {
  data.has_doc_change = true;
  data.updated_at = vars.now || '';
  if (!data.doc_review) data.doc_review = {};
  data.doc_review.passed = false;
  if (query.includes('aggregate_gate.executed = false') && data.aggregate_gate) {
    data.aggregate_gate.executed = false;
    data.aggregate_gate.gate = null;
    data.aggregate_gate.reason = null;
  }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// ---- has() predicates ----
if (query && query.startsWith('has(')) {
  const m = query.match(/has\\("([^"]+)"\\)/);
  const k = m ? m[1] : '';
  const has = Object.prototype.hasOwnProperty.call(data, k);
  process.stdout.write(has ? 'true' : 'false');
  process.exit(has ? 0 : 1);
}

// ---- Aggregate gate filters ----
if (query && query.includes('review_mode') && query.includes('aggregate_gate.executed = false')) {
  data.review_mode = 'dual';
  if (!data.aggregate_gate) data.aggregate_gate = {};
  data.aggregate_gate.executed = false;
  data.aggregate_gate.gate = null;
  data.aggregate_gate.source = null;
  data.aggregate_gate.reason = null;
  data.aggregate_gate.last_run = vars.now || '';
  data.updated_at = vars.now || '';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('aggregate_gate.executed = true') && query.includes('aggregate_gate.gate = $gate')) {
  if (!data.aggregate_gate) data.aggregate_gate = {};
  data.aggregate_gate.executed = true;
  data.aggregate_gate.gate = vars.gate || '';
  data.aggregate_gate.reason = null;
  data.aggregate_gate.last_run = vars.now || '';
  data.updated_at = vars.now || '';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('aggregate_gate.gate = "BLOCKED"') && query.includes('aggregate_gate.reason = $reason')) {
  data.review_mode = 'dual';
  if (!data.aggregate_gate) data.aggregate_gate = {};
  data.aggregate_gate.executed = true;
  data.aggregate_gate.gate = 'BLOCKED';
  data.aggregate_gate.reason = vars.reason || '';
  data.aggregate_gate.last_run = vars.now || '';
  data.updated_at = vars.now || '';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('aggregate_gate.executed = false') && query.includes('aggregate_gate.gate = null')) {
  if (data.aggregate_gate) {
    data.aggregate_gate.executed = false;
    data.aggregate_gate.gate = null;
    data.aggregate_gate.reason = null;
  }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// ---- update_state: [$key] ----
if (query && query.includes('[$key]') && vars.key) {
  if (!data[vars.key] || typeof data[vars.key] !== 'object') data[vars.key] = {};
  data[vars.key].executed = vars.executed;
  data[vars.key].passed = vars.passed;
  data[vars.key].last_run = vars.now;
  data.updated_at = vars.now;
  // Convergence reset (terminal gate passed) — mirrors the real jq filter.
  // An EXHAUSTED budget is never refunded: otherwise a run that burned the whole
  // cap and then happened to pass would erase the evidence before stop-guard reads it.
  if (vars.passed === true && (vars.key === 'precommit' || vars.key === 'doc_review')
      && data.iteration_history
      && (data.iteration_history.current_round || 0) < (data.iteration_history.max_rounds || 30)) {
    data.iteration_history.current_round = 0;
    data.iteration_history.findings_by_round = [];
  }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// ---- invalidate_review (.passed = false) ----
if (query && query.includes('.passed = false') && vars.key) {
  if (data[vars.key] && typeof data[vars.key] === 'object') data[vars.key].passed = false;
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// ---- Passed-value reads ----
if (query && query.includes('.code_review.passed')) { process.stdout.write(asBoolString(data.code_review && data.code_review.passed)); process.exit(0); }
if (query && query.includes('.doc_review.passed')) { process.stdout.write(asBoolString(data.doc_review && data.doc_review.passed)); process.exit(0); }
if (query && query.includes('.precommit.passed')) { process.stdout.write(asBoolString(data.precommit && data.precommit.passed)); process.exit(0); }
if (query && query.includes('.has_code_change')) { process.stdout.write(asBoolString(data.has_code_change)); process.exit(0); }
if (query && query.includes('.has_doc_change')) { process.stdout.write(asBoolString(data.has_doc_change)); process.exit(0); }
if (query === '.gate // empty') { process.stdout.write(data.gate || ''); process.exit(0); }

// ---- schema & iteration ----
if (query && query.includes('schema_version // 1')) { process.stdout.write(String(data.schema_version || 1)); process.exit(0); }
if (query && query.includes('schema_version = 2') && query.includes('iteration_history')) {
  data.schema_version = 2;
  if (!data.iteration_history) data.iteration_history = { current_round: 0, max_rounds: 30, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false };
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('iteration_history.current_round += 1')) {
  if (!data.iteration_history) data.iteration_history = { current_round: 0, max_rounds: 30, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false };
  data.iteration_history.current_round += 1;
  data.iteration_history.total_rounds_session = (data.iteration_history.total_rounds_session || 0) + 1;
  data.iteration_history.findings_by_round.push({ round: data.iteration_history.current_round, total: vars.total || 0, p0: vars.p0 || 0, p1: vars.p1 || 0, p2: vars.p2 || 0, nit: vars.nit || 0, timestamp: vars.now || '' });
  data.updated_at = vars.now || '';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('iteration_history.current_round = 0')) {
  if (data.iteration_history) { data.iteration_history.current_round = 0; data.iteration_history.findings_by_round = []; }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// ---- review_phase (D-4) ----
if (query && query.includes('review_phase')) {
  const m = query.match(/review_phase = "([^"]+)"/);
  if (m) data.review_phase = m[1];
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// ---- session_commit_scope (D-5) no-op passthrough ----
if (query && query.includes('session_commit_scope')) {
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// ---- contains() ----
if (query && query.includes('contains(')) {
  if (hasExitFlag) process.exit(1);
  process.stdout.write('null');
  process.exit(0);
}

process.stdout.write('');
process.exit(0);
`;
}

function setupStubBin(opts) {
  const binDir = makeTempDir('sd0x-changed-files-bin-');
  writeExecutable(join(binDir, 'jq'), jqStubSource(opts));
  writeExecutable(join(binDir, 'npx'), '#!/bin/sh\nexit 0\n');
  return binDir;
}

function runEditHook({ cwd, binDir, filePath, env = {} }) {
  const input = { tool_input: { file_path: filePath } };
  return spawnSync('bash', [editHookPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ...env },
  });
}

function runReviewHook({ cwd, binDir, input, env = {} }) {
  return spawnSync('bash', [reviewHookPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ...env },
  });
}

function readState(cwd) {
  const p = join(cwd, '.claude_review_state.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// =============================================================================
// D-3: changed_files_since_review tracking + reset (R13)
// =============================================================================

// WB5b: post-edit-format.sh no longer creates or migrates the state file —
// session-init.sh owns creation. Tracking tests therefore seed the minimal
// state the edit hook now REQUIRES to record anything.
function seedState(workDir) {
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    schema_version: 2,
    has_code_change: false,
    code_review: { executed: false, passed: false, last_run: '' },
    iteration_history: { current_round: 0, max_rounds: 10, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false },
  }));
}

test('WB5b retirement pin: a code edit with NO state file creates none (session-init owns creation)', () => {
  const workDir = makeTempDir('sd0x-cf-nostate-');
  const binDir = setupStubBin();
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/app.ts', env: { HOOK_NO_FORMAT: '1' } });
  assert.equal(readState(workDir), null,
    'the edit hook must not resurrect state-file creation — gates re-open by derivation, not by stored flags');
});

test('single code edit appends file to changed_files_since_review', () => {
  const workDir = makeTempDir('sd0x-cf-single-');
  const binDir = setupStubBin();
  seedState(workDir);
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/app.ts', env: { HOOK_NO_FORMAT: '1' } });
  const state = readState(workDir);
  assert.ok(state, 'state file should exist after code edit');
  assert.deepEqual(
    state.changed_files_since_review, ['/project/src/app.ts'],
    'changed_files_since_review should contain the edited file'
  );
});

test('editing same file twice does not produce duplicates (unique)', () => {
  const workDir = makeTempDir('sd0x-cf-unique-');
  const binDir = setupStubBin();
  seedState(workDir);
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/app.ts', env: { HOOK_NO_FORMAT: '1' } });
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/app.ts', env: { HOOK_NO_FORMAT: '1' } });
  const state = readState(workDir);
  assert.ok(state);
  assert.deepEqual(
    state.changed_files_since_review, ['/project/src/app.ts'],
    'repeated edits of the same file must remain unique'
  );
});

test('editing two different code files tracks both', () => {
  const workDir = makeTempDir('sd0x-cf-two-');
  const binDir = setupStubBin();
  seedState(workDir);
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/a.ts', env: { HOOK_NO_FORMAT: '1' } });
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/b.ts', env: { HOOK_NO_FORMAT: '1' } });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.changed_files_since_review.length, 2);
  assert.ok(state.changed_files_since_review.includes('/project/src/a.ts'));
  assert.ok(state.changed_files_since_review.includes('/project/src/b.ts'));
});

test('doc edit also appends to changed_files_since_review', () => {
  const workDir = makeTempDir('sd0x-cf-doc-');
  const binDir = setupStubBin();
  seedState(workDir);
  runEditHook({ cwd: workDir, binDir, filePath: '/project/docs/readme.md', env: { HOOK_NO_FORMAT: '1' } });
  const state = readState(workDir);
  assert.ok(state);
  assert.deepEqual(state.changed_files_since_review, ['/project/docs/readme.md']);
});

test('// [] fallback: state missing changed_files_since_review still produces [f]', () => {
  const workDir = makeTempDir('sd0x-cf-fallback-');
  const binDir = setupStubBin();
  const statePath = join(workDir, '.claude_review_state.json');
  writeFileSync(statePath, JSON.stringify({
    schema_version: 2,
    has_code_change: false,
    code_review: { executed: false, passed: false, last_run: '' },
    iteration_history: { current_round: 0, max_rounds: 10, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false },
  }));
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/legacy.ts', env: { HOOK_NO_FORMAT: '1' } });
  const state = readState(workDir);
  assert.ok(state);
  assert.deepEqual(
    state.changed_files_since_review, ['/project/src/legacy.ts'],
    'jq // [] fallback must produce a fresh single-element array on legacy v2 state'
  );
});

test('code_review pass resets changed_files_since_review to empty array', () => {
  // WB5b retired the legacy Bash/Skill verdict route — a `/codex-review-fast`
  // Bash line no longer records a verdict. The reset now rides the MCP route
  // (request provenance + headed output + sentinel), which needs REAL jq: the
  // stub's short-circuits would skip the provenance checks the route depends on.
  const workDir = makeTempDir('sd0x-cf-reset-');
  const realBinDir = makeTempDir('sd0x-cf-reset-bin-');
  writeExecutable(join(realBinDir, 'npx'), '#!/bin/sh\nexit 0\n');
  seedState(workDir);
  runEditHook({ cwd: workDir, binDir: realBinDir, filePath: '/project/src/app.ts', env: { HOOK_NO_FORMAT: '1' } });
  let state = readState(workDir);
  assert.deepEqual(state.changed_files_since_review, ['/project/src/app.ts']);
  const result = runReviewHook({
    cwd: workDir,
    binDir: realBinDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: {
        prompt: 'You are a senior Code Reviewer. Review the changes.\n\n## Output Format\n\n### Merge Gate\n\n- ✅ Ready: No P0/P1, safe to merge\n- ⛔ Blocked: Has P0/P1, needs fix',
      },
      tool_response: { content: [{ type: 'text', text: '### Merge Gate\n✅ Ready\n' }] },
    },
  });
  assert.equal(result.status, 0);
  state = readState(workDir);
  assert.ok(state);
  assert.equal(state.code_review.passed, true, 'the MCP route must record the pass');
  assert.deepEqual(
    state.changed_files_since_review, [],
    'code_review pass must reset changed_files_since_review to []'
  );
});

test('jq stub returning a degenerate result preserves existing changed_files_since_review', () => {
  const workDir = makeTempDir('sd0x-cf-graceful-');
  // Track filter returns "{}" (short/empty) → hook size guard rejects the replacement
  const binDir = setupStubBin({ trackMode: 'writes-short' });
  const statePath = join(workDir, '.claude_review_state.json');
  writeFileSync(statePath, JSON.stringify({
    schema_version: 2,
    has_code_change: true,
    code_review: { executed: true, passed: false, last_run: '2026-04-21T00:00:00Z' },
    iteration_history: { current_round: 0, max_rounds: 10, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false },
    changed_files_since_review: ['/project/src/existing.ts'],
  }));
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/new.ts', env: { HOOK_NO_FORMAT: '1' } });
  const state = readState(workDir);
  assert.ok(state);
  assert.deepEqual(
    state.changed_files_since_review, ['/project/src/existing.ts'],
    'degenerate _track_changed_file jq output must not clobber the existing array'
  );
});
