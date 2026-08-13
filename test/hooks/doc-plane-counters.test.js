'use strict';

// Doc-plane advisory counters (`_bump_doc_counter`), end-to-end through the PreToolUse branch.
//
// Relocated from background-verdict-recovery.test.js when WB5b retired the recovery machinery
// that file existed for — these two behaviours survive it. They run against REAL jq (the
// post-tool-review-state suite stubs jq via PATH, so the wiring cannot be proven there; the
// filter-level real-jq pins live in jq-filter-fidelity.test.js). Also pins the retirement
// itself: a PreToolUse dispatch must no longer stamp the state file with the retired
// dispatch-epoch keys.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const hookPath = resolve(__dirname, '../../hooks/post-tool-review-state.sh');
const HAVE_JQ = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// Every hook run may invoke dispatch-cli.js (WB3), which appends records under
// ${XDG_CACHE_HOME}/sd0x-dev-flow/receipts/<repo-slug>. Pointing that at a suite-owned temp dir
// keeps the user's real cache clean; it must lie OUTSIDE each temp repo (receipt-log refuses a
// cache dir inside the repo root by design).
const CACHE_DIR = mkdtempSync(join(tmpdir(), 'sd0x-doccount-cache-'));
tempDirs.push(CACHE_DIR);

// The harness always sends `session_id`; dispatch-cli refuses a payload without one, and on a
// review-requesting PreToolUse that refusal is the hook's exit-2 duty.
const SESSION_ID = 'sess-doccount-fixture';

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Counter Fixture');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'seed.txt'), 'baseline\n');
  git('add', 'seed.txt');
  git('commit', '-q', '-m', 'baseline');
  return dir;
}

// Post-WB5b schema: no stored change flags, no background_reviews, no dispatch-epoch keys.
function seedState(dir) {
  writeFileSync(join(dir, '.claude_review_state.json'), JSON.stringify({
    session_id: '',
    updated_at: '',
    review_mode: 'single',
    code_review: { executed: false, passed: false, last_run: '' },
    doc_review: { executed: false, passed: false, last_run: '' },
    precommit: { executed: false, passed: false, last_run: '' },
    aggregate_gate: { executed: false, gate: null, source: null, reason: null, last_run: '' },
    schema_version: 3,
    iteration_history: {
      current_round: 0, max_rounds: 30, findings_by_round: [],
      total_rounds_session: 0, strategic_reset_fired: false,
    },
  }, null, 2));
}

function readState(dir) {
  return JSON.parse(readFileSync(join(dir, '.claude_review_state.json'), 'utf8'));
}

function runPreHook(cwd, prompt) {
  const childEnv = { ...process.env, XDG_CACHE_HOME: CACHE_DIR };
  delete childEnv.CLAUDE_PLUGIN_ROOT;
  delete childEnv.CLAUDE_PROJECT_DIR;
  return spawnSync('bash', [hookPath], {
    cwd,
    encoding: 'utf8',
    env: childEnv,
    input: JSON.stringify({
      session_id: SESSION_ID,
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt },
      transcript_path: join(cwd, 'transcript.jsonl'),
    }),
  });
}

// The request-side predicates key on the section headers the prompt templates mandate; these are
// the literals `_mcp_request_asked_for_*_review` greps for, not decoration.
const CODE_REQUEST = 'Review this diff and end with a ## Merge Gate section.';
const DOC_REQUEST = 'Review these docs and end with a ## Document Review section.';

test('a doc-plane PreToolUse dispatch increments the advisory doc counter', { skip: !HAVE_JQ }, () => {
  const dir = makeTempDir('sd0x-doccount-doc-');
  seedState(dir);

  const first = runPreHook(dir, DOC_REQUEST);
  assert.equal(first.status, 0, `hook must accept the dispatch: ${first.stderr}`);
  const afterOne = readState(dir);
  assert.equal(afterOne.doc_iteration_history.dispatches, 1, 'the doc dispatch is counted');
  assert.equal(afterOne.doc_iteration_history.verdicts, 0, 'no verdict has arrived yet');

  runPreHook(dir, DOC_REQUEST);
  assert.equal(readState(dir).doc_iteration_history.dispatches, 2, 'a second dispatch adds one');
});

// Negative control for the case above. Without it, a bump wired to every dispatch — rather than
// to the doc plane's — would look identical: the doc test would still pass.
test('a code-plane PreToolUse dispatch leaves the doc counter untouched', { skip: !HAVE_JQ }, () => {
  const dir = makeTempDir('sd0x-doccount-code-');
  seedState(dir);

  const r = runPreHook(dir, CODE_REQUEST);
  assert.equal(r.status, 0, `hook must accept the dispatch: ${r.stderr}`);
  assert.equal(readState(dir).doc_iteration_history, undefined, 'no doc counter was created');
});

// WB5b retirement pin: the PreToolUse branch must no longer stamp the state file with the
// retired per-plane epoch machinery — the dispatch log is the only reservation now.
test('a PreToolUse dispatch stamps none of the retired dispatch-epoch keys', { skip: !HAVE_JQ }, () => {
  const dir = makeTempDir('sd0x-doccount-retired-');
  seedState(dir);

  runPreHook(dir, DOC_REQUEST);
  runPreHook(dir, CODE_REQUEST);
  const state = readState(dir);
  for (const key of ['dispatch_epoch', 'dispatch_count', 'seq_counter', 'background_reviews']) {
    assert.equal(state[key], undefined, `retired key ${key} must not be written`);
  }
});
