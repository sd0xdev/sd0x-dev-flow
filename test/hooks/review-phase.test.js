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
const stopGuardPath = resolve(__dirname, '../../hooks/stop-guard.sh');
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

// Shared jq stub that handles filters exercised by all three hooks.
// Opts:
//   phaseWrite: 'normal' | 'fail' — when 'fail', the review_phase update filter
//     returns empty stdout so the hook's size guard rejects the write
//     (exercises the "jq stub failure on phase update → graceful no-op" path).
function jqStubSource(opts = {}) {
  const phaseWrite = opts.phaseWrite || 'normal';
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

function asBool(v) { return v === true || v === 'true' ? 'true' : 'false'; }
function out(v) {
  if (v === undefined || v === null) { process.stdout.write(''); return; }
  if (typeof v === 'string') { process.stdout.write(v); return; }
  if (typeof v === 'boolean') { process.stdout.write(asBool(v)); return; }
  process.stdout.write(JSON.stringify(v));
}

// =============================================================================
// Pure READ queries (use // fallback operator, never mutate state)
// Must come FIRST so they're not accidentally matched by loose write-handlers.
// =============================================================================
if (query === '.tool_name // empty') { process.stdout.write(data.tool_name || ''); process.exit(0); }
if (query === '.tool_input // empty') {
  if (data.tool_input === undefined || data.tool_input === null) process.stdout.write('');
  else if (typeof data.tool_input === 'string') process.stdout.write(data.tool_input);
  else process.stdout.write(JSON.stringify(data.tool_input));
  process.exit(0);
}
if (query === '.tool_output // empty') {
  if (data.tool_output === undefined || data.tool_output === null) process.stdout.write('');
  else if (typeof data.tool_output === 'string') process.stdout.write(data.tool_output);
  else process.stdout.write(JSON.stringify(data.tool_output));
  process.exit(0);
}
if (query === '.command // empty') { process.stdout.write(data.command || ''); process.exit(0); }
if (query === '.skill // empty') { process.stdout.write(data.skill || ''); process.exit(0); }
if (query === '.review_phase // "idle"') { out(data.review_phase || 'idle'); process.exit(0); }
if (query === '.has_code_change // false') { out(asBool(data.has_code_change)); process.exit(0); }
if (query === '.has_doc_change // false') { out(asBool(data.has_doc_change)); process.exit(0); }
if (query === '.code_review.passed // false') { out(asBool(data.code_review && data.code_review.passed)); process.exit(0); }
if (query === '.doc_review.passed // false') { out(asBool(data.doc_review && data.doc_review.passed)); process.exit(0); }
if (query === '.precommit.passed // false') { out(asBool(data.precommit && data.precommit.passed)); process.exit(0); }
if (query === '.review_mode // "single"') { out(data.review_mode || 'single'); process.exit(0); }
if (query === '.aggregate_gate.executed // false') { out(asBool((data.aggregate_gate || {}).executed)); process.exit(0); }
if (query === '.aggregate_gate.gate // empty') { out((data.aggregate_gate || {}).gate || ''); process.exit(0); }
if (query === '.iteration_history.current_round // 0') { out(String(((data.iteration_history || {}).current_round) || 0)); process.exit(0); }
if (query === '.iteration_history.max_rounds // 10') { out(String(((data.iteration_history || {}).max_rounds) || 10)); process.exit(0); }
if (query === '.transcript_path // empty') { out(data.transcript_path || ''); process.exit(0); }
if (query === '.stop_hook_active // false') { out(asBool(data.stop_hook_active)); process.exit(0); }
if (query && query.includes('schema_version // 1')) { process.stdout.write(String(data.schema_version || 1)); process.exit(0); }

if (query && query.includes('env.STOP_GUARD_MODE')) {
  const envVal = (data.env && data.env.STOP_GUARD_MODE) || '';
  const legacyVal = (data.hooks_config && data.hooks_config.stop_guard_mode) || '';
  process.stdout.write(envVal || legacyVal);
  process.exit(0);
}
if (query && query.includes('contains(')) {
  if (hasExitFlag) process.exit(1);
  process.stdout.write('null');
  process.exit(0);
}
if (query && query.includes('.tool_input.file_path')) { const ti = data.tool_input || {}; process.stdout.write(ti.file_path || (query.includes('notebook_path') ? ti.notebook_path : '') || ''); process.exit(0); }
if (query && query.includes('tool_output') && query.includes('type') && query.includes('content')) {
  const to = data.tool_output;
  if (to && typeof to === 'object') {
    const c = to.content;
    if (typeof c === 'string') process.stdout.write(c);
    else if (Array.isArray(c)) process.stdout.write(c.filter(x => x.type === 'text').map(x => x.text).join('\\n'));
    else process.stdout.write(JSON.stringify(to));
  } else process.stdout.write(typeof to === 'string' ? to : '');
  process.exit(0);
}
if (query && query.startsWith('has(')) {
  const m = query.match(/has\\("([^"]+)"\\)/);
  const has = m ? Object.prototype.hasOwnProperty.call(data, m[1]) : false;
  process.stdout.write(has ? 'true' : 'false');
  process.exit(has ? 0 : 1);
}

// =============================================================================
// WRITE queries (order matters — most specific first)
// =============================================================================

// Combined aggregate_gate + review_phase filters (emit-review-gate branch)
// These MUST come before the generic review_phase assignment handler.
if (query && query.includes('review_phase = "precommit_pending"')) {
  if (!data.aggregate_gate) data.aggregate_gate = {};
  data.aggregate_gate.executed = true;
  data.aggregate_gate.gate = vars.gate || 'READY';
  data.aggregate_gate.reason = null;
  data.aggregate_gate.last_run = vars.now || '';
  data.updated_at = vars.now || '';
  data.review_phase = 'precommit_pending';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('review_phase = "addressing_findings"')) {
  if (!data.aggregate_gate) data.aggregate_gate = {};
  data.aggregate_gate.executed = true;
  data.aggregate_gate.gate = vars.gate || 'BLOCKED';
  data.aggregate_gate.reason = null;
  data.aggregate_gate.last_run = vars.now || '';
  data.updated_at = vars.now || '';
  data.review_phase = 'addressing_findings';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
// PENDING-gate combined filter (review_mode dual + pending_review)
if (query && query.includes('review_mode = "dual"') && query.includes('review_phase = "pending_review"')) {
  data.review_mode = 'dual';
  if (!data.aggregate_gate) data.aggregate_gate = {};
  data.aggregate_gate.executed = false;
  data.aggregate_gate.gate = null;
  data.aggregate_gate.source = null;
  data.aggregate_gate.reason = null;
  data.aggregate_gate.last_run = vars.now || '';
  data.updated_at = vars.now || '';
  data.review_phase = 'pending_review';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Single-field review_phase assignments (edit-hook / precommit-pass path)
if (query && query.includes('.review_phase = "pending_review"')) {
  ${phaseWrite === 'fail'
    ? "process.stdout.write(''); process.exit(0);"
    : `data.review_phase = 'pending_review';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);`}
}
if (query && query.includes('.review_phase = "idle"')) {
  data.review_phase = 'idle';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Edit-hook flag merges
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

// Track changed files (D-3)
if (query && query.includes('changed_files_since_review') && vars.f) {
  const existing = data.changed_files_since_review || [];
  const merged = existing.slice();
  if (!merged.includes(vars.f)) merged.push(vars.f);
  data.changed_files_since_review = merged;
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('.changed_files_since_review = []')) {
  data.changed_files_since_review = [];
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Schema migrations
if (query && query.includes('schema_version = 2') && query.includes('iteration_history')) {
  data.schema_version = 2;
  if (!data.iteration_history) data.iteration_history = { current_round: 0, max_rounds: 10, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false };
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('iteration_history.current_round = 0')) {
  if (data.iteration_history) { data.iteration_history.current_round = 0; data.iteration_history.findings_by_round = []; }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
if (query && query.includes('iteration_history.current_round += 1')) {
  if (!data.iteration_history) data.iteration_history = { current_round: 0, max_rounds: 10, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false };
  data.iteration_history.current_round += 1;
  data.iteration_history.total_rounds_session = (data.iteration_history.total_rounds_session || 0) + 1;
  data.iteration_history.findings_by_round.push({ round: data.iteration_history.current_round });
  data.updated_at = vars.now || '';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// update_state [$key] write
if (query && query.includes('[$key]') && vars.key) {
  if (!data[vars.key] || typeof data[vars.key] !== 'object') data[vars.key] = {};
  data[vars.key].executed = vars.executed;
  data[vars.key].passed = vars.passed;
  data[vars.key].last_run = vars.now;
  data.updated_at = vars.now;
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Invalidate review (edit hook)
if (query && query.includes('.passed = false') && vars.key) {
  if (data[vars.key] && typeof data[vars.key] === 'object') data[vars.key].passed = false;
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}
// aggregate_gate invalidation (edit hook)
if (query && query.includes('aggregate_gate.executed = false') && query.includes('aggregate_gate.gate = null')) {
  if (data.aggregate_gate) {
    data.aggregate_gate.executed = false;
    data.aggregate_gate.gate = null;
    data.aggregate_gate.reason = null;
  }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Session commit scope passthrough
if (query && query.includes('session_commit_scope')) {
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

process.stdout.write('');
process.exit(0);
`;
}

function setupStubBin(opts) {
  const binDir = makeTempDir('sd0x-review-phase-bin-');
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

function runStopGuard({ cwd, binDir, input, env = {} }) {
  const { STOP_GUARD_MODE: _drop, ...cleanEnv } = process.env;
  return spawnSync('bash', [stopGuardPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...cleanEnv, PATH: `${binDir}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: cwd, ...env },
  });
}

function readState(cwd) {
  const p = join(cwd, '.claude_review_state.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeTranscript(cwd) {
  const p = join(cwd, 'transcript.json');
  writeFileSync(p, '[]');
  return p;
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// =============================================================================
// D-4: review_phase state machine (R14)
// =============================================================================

// --- Transitions written by the hooks ---

test('T1: code edit transitions review_phase → pending_review', () => {
  const workDir = makeTempDir('sd0x-rp-t1-');
  const binDir = setupStubBin();
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/app.ts', env: { HOOK_NO_FORMAT: '1' } });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.review_phase, 'pending_review');
});

test('T2: PENDING aggregate gate sets review_phase → pending_review', () => {
  const workDir = makeTempDir('sd0x-rp-t2-');
  const binDir = setupStubBin();
  // Seed a state file so emit-review-gate doesn't init from scratch
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    schema_version: 2,
    has_code_change: true,
    code_review: { executed: false, passed: false, last_run: '' },
    iteration_history: { current_round: 0, max_rounds: 10, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false },
  }));
  const result = runReviewHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: 'bash scripts/emit-review-gate.sh PENDING' },
      tool_output: 'REVIEW_GATE=PENDING',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.review_phase, 'pending_review');
});

test('T3: READY aggregate gate sets review_phase → precommit_pending', () => {
  const workDir = makeTempDir('sd0x-rp-t3-');
  const binDir = setupStubBin();
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    schema_version: 2,
    has_code_change: true,
    aggregate_gate: { executed: false, gate: null, source: null, reason: null, last_run: '' },
  }));
  const result = runReviewHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: 'bash scripts/emit-review-gate.sh READY' },
      tool_output: 'REVIEW_GATE=READY',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.review_phase, 'precommit_pending');
});

test('T4: BLOCKED aggregate gate sets review_phase → addressing_findings', () => {
  const workDir = makeTempDir('sd0x-rp-t4-');
  const binDir = setupStubBin();
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    schema_version: 2,
    has_code_change: true,
    aggregate_gate: { executed: false, gate: null, source: null, reason: null, last_run: '' },
  }));
  const result = runReviewHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: 'bash scripts/emit-review-gate.sh BLOCKED' },
      tool_output: 'REVIEW_GATE=BLOCKED',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.review_phase, 'addressing_findings');
});

test('T5: /precommit pass sets review_phase → idle', () => {
  const workDir = makeTempDir('sd0x-rp-t5-');
  const binDir = setupStubBin();
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    schema_version: 2,
    has_code_change: true,
    review_phase: 'precommit_pending',
    precommit: { executed: false, passed: false, last_run: '' },
  }));
  const result = runReviewHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/precommit' },
      tool_output: '## Overall: ✅ PASS',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.review_phase, 'idle');
});

test('T6: MCP precommit ✅ PASS sets review_phase → idle', () => {
  const workDir = makeTempDir('sd0x-rp-t6-');
  const binDir = setupStubBin();
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    schema_version: 2,
    has_code_change: true,
    review_phase: 'precommit_pending',
    precommit: { executed: false, passed: false, last_run: '' },
  }));
  const result = runReviewHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: {},
      tool_output: '## Overall: ✅ PASS\nall tests green',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.review_phase, 'idle');
});

// --- stop-guard phase-aware hint ---

test('T7: stop-guard strict mode with missing code review + phase=pending_review includes phase hint', () => {
  const workDir = makeTempDir('sd0x-rp-t7-');
  const binDir = setupStubBin();
  const transcript = writeTranscript(workDir);
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: false },
    precommit: { passed: true },
    doc_review: { passed: true },
    review_phase: 'pending_review',
  }));
  const result = runStopGuard({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcript },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'strict mode must block when code review missing');
  const payload = JSON.parse(result.stdout);
  assert.match(payload.description || '', /\(phase:pending_review\)/, 'reason must include phase hint');
});

test('T8: stop-guard with missing work + phase=idle omits phase hint', () => {
  const workDir = makeTempDir('sd0x-rp-t8-');
  const binDir = setupStubBin();
  const transcript = writeTranscript(workDir);
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: false },
    precommit: { passed: true },
    doc_review: { passed: true },
    review_phase: 'idle',
  }));
  const result = runStopGuard({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcript },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout);
  assert.doesNotMatch(payload.description || '', /\(phase:/, 'idle phase must not be annotated');
});

test('T9: stop-guard with no missing work omits phase hint even if phase ≠ idle', () => {
  const workDir = makeTempDir('sd0x-rp-t9-');
  const binDir = setupStubBin();
  const transcript = writeTranscript(workDir);
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    has_code_change: false,
    has_doc_change: false,
    code_review: { passed: true },
    precommit: { passed: true },
    doc_review: { passed: true },
    review_phase: 'precommit_pending',
  }));
  const result = runStopGuard({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcript },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'no missing work → allow stop regardless of phase');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true, 'stop-guard must emit ok:true when no work missing');
  // No MISSING → no phase hint in reason or description
  assert.ok(!(payload.reason || '').includes('(phase:'));
  assert.ok(!(payload.description || '').includes('(phase:'));
});

// --- Init + edge cases ---

test('T10: edit on fresh workdir creates state and sets review_phase', () => {
  const workDir = makeTempDir('sd0x-rp-t10-');
  const binDir = setupStubBin();
  // No pre-existing state file
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/fresh.ts', env: { HOOK_NO_FORMAT: '1' } });
  const state = readState(workDir);
  assert.ok(state, 'state file must be created from fresh edit');
  assert.equal(state.review_phase, 'pending_review');
});

test('T11: phase update with failing jq is graceful (no crash, no phase field mutation)', () => {
  const workDir = makeTempDir('sd0x-rp-t11-');
  const binDir = setupStubBin({ phaseWrite: 'fail' });
  // Pre-seed state with a different phase so we can detect whether the failing
  // jq filter silently no-ops (preserves existing phase) or crashes
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    schema_version: 2,
    has_code_change: false,
    review_phase: 'idle',
    code_review: { executed: true, passed: true, last_run: '2026-04-21T00:00:00Z' },
    precommit: { executed: true, passed: true, last_run: '2026-04-21T00:00:00Z' },
    iteration_history: { current_round: 0, max_rounds: 10, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false },
  }));
  const result = runEditHook({ cwd: workDir, binDir, filePath: '/project/src/app.ts', env: { HOOK_NO_FORMAT: '1' } });
  assert.equal(result.status, 0, 'hook must not crash when jq phase update fails');
  const state = readState(workDir);
  assert.ok(state);
  // When the phase-update jq filter fails (returns empty), the size guard
  // rejects the replacement, so review_phase stays at the seeded "idle".
  assert.equal(state.review_phase, 'idle', 'failed phase update must leave existing phase untouched');
});

test('T12: doc-only edit does not flip phase to pending_review', () => {
  const workDir = makeTempDir('sd0x-rp-t12-');
  const binDir = setupStubBin();
  // Seed state with an existing non-pending_review phase
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({
    schema_version: 2,
    has_code_change: false,
    review_phase: 'idle',
    iteration_history: { current_round: 0, max_rounds: 10, findings_by_round: [], total_rounds_session: 0, strategic_reset_fired: false },
  }));
  runEditHook({ cwd: workDir, binDir, filePath: '/project/docs/readme.md', env: { HOOK_NO_FORMAT: '1' } });
  const state = readState(workDir);
  assert.ok(state);
  assert.notEqual(
    state.review_phase, 'pending_review',
    'doc edit must not flip review_phase to pending_review (that phase is code-review specific)'
  );
});

test('T13: sequential edits keep phase at pending_review (idempotent)', () => {
  const workDir = makeTempDir('sd0x-rp-t13-');
  const binDir = setupStubBin();
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/a.ts', env: { HOOK_NO_FORMAT: '1' } });
  const state1 = readState(workDir);
  assert.equal(state1.review_phase, 'pending_review');
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/b.ts', env: { HOOK_NO_FORMAT: '1' } });
  const state2 = readState(workDir);
  assert.equal(state2.review_phase, 'pending_review', 'second edit must not change phase away from pending_review');
});

test('T14: full cycle edit → READY → precommit pass ends at review_phase = idle', () => {
  const workDir = makeTempDir('sd0x-rp-t14-');
  const binDir = setupStubBin();
  runEditHook({ cwd: workDir, binDir, filePath: '/project/src/cycle.ts', env: { HOOK_NO_FORMAT: '1' } });
  assert.equal(readState(workDir).review_phase, 'pending_review');
  runReviewHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: 'bash scripts/emit-review-gate.sh READY' },
      tool_output: 'REVIEW_GATE=READY',
    },
  });
  assert.equal(readState(workDir).review_phase, 'precommit_pending');
  runReviewHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/precommit' },
      tool_output: '## Overall: ✅ PASS',
    },
  });
  assert.equal(readState(workDir).review_phase, 'idle', 'full cycle must return to idle');
});
