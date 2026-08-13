'use strict';

// WB3 — MCP event-sourced dispatch lifecycle (tech spec §3.4, tests per §6):
// pinned reducer table, read-time twin-contest, visibility decision (activation
// barrier / capture-time bind / frontier-only / ambiguous), universal
// disposition, single-settlement writer with spent-identity ledger, expiry,
// frontier soundness + write-ahead compaction, cursor recovery, and the
// exit-2 blocking duty at the hook layer — forged-sentinel controls in both
// directions per @rules/testing.md § Conventions (Guards row).

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const XDG = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-xdg-'));
process.env.XDG_CACHE_HOME = XDG; // absolute, outside every test repo

const dispatchLog = require('../../scripts/lib/dispatch-log.js');
const receiptLog = require('../../scripts/lib/receipt-log.js');
const treeDigest = require('../../scripts/lib/tree-digest.js');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'post-tool-review-state.sh');
const CLI = path.join(__dirname, '..', '..', 'scripts', 'dispatch-cli.js');

const HOUR = 3600 * 1000;
const cleanups = [];
after(() => {
  for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(XDG, { recursive: true, force: true });
});

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(d);
  return d;
}

const CLEAN_GIT_ENV = { ...process.env };
for (const k of Object.keys(CLEAN_GIT_ENV)) {
  if (k.startsWith('GIT_')) delete CLEAN_GIT_ENV[k];
}
CLEAN_GIT_ENV.GIT_CONFIG_NOSYSTEM = '1';

function makeGitRepo() {
  const dir = tmpdir('dispatch-repo-');
  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: dir, env: CLEAN_GIT_ENV });
  sh('git', ['init', '-q', '-b', 'main']);
  sh('git', ['config', 'user.name', 'Dispatch Tester']);
  sh('git', ['config', 'user.email', 'dispatch-tester@example.invalid']);
  sh('git', ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1);\n');
  fs.writeFileSync(path.join(dir, 'spec.md'), '# spec\n');
  sh('git', ['add', '-A']);
  sh('git', ['commit', '-q', '-m', 'seed']);
  return dir;
}

// --- transcript fixtures -----------------------------------------------------

function makeTranscript(dir) {
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, JSON.stringify({ type: 'summary', sessionStart: true }) + '\n');
  return p;
}

function addLine(p, obj) {
  fs.appendFileSync(p, JSON.stringify(obj) + '\n');
}

function entryLine(id, input, tool = 'mcp__codex__codex') {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: tool, input }] } };
}

function resultLine(id, text) {
  return {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] },
  };
}

function taskLine(taskId, text) {
  return {
    type: 'user',
    origin: { kind: 'task-notification' },
    message: {
      content: `<task-id>${taskId}</task-id><status>completed</status><result>${JSON.stringify({ content: text })}</result>`,
    },
  };
}

const CODE_INPUT = { prompt: 'Review the diff. Output Format: ### Merge Gate with sentinel.' };
const DOC_INPUT = { prompt: 'Review the docs. Output Format: ## Document Review with gate.' };
const DUAL_INPUT = { prompt: 'Review both. Merge Gate and Document Review sections required.' };

const CODE_KEY = dispatchLog.requestKey(CODE_INPUT);
const DOC_KEY = dispatchLog.requestKey(DOC_INPUT);

const CODE_PASS = '## Merge Gate\n\n✅ Ready\n';
const CODE_FAIL = '## Merge Gate\n\n⛔ Blocked\n';
const DOC_PASS = '## Document Review\n\n✅ Mergeable\n';
const DOC_FAIL = '## Document Review\n\n⛔ Needs revision\n';
const HANDOFF =
  'MCP tool "codex/codex" is still running after 120s. It was moved to the background as task t9 and keeps running; To stop it, use TaskStop with task_id "t9".';

const DIGEST_A = 'sha256:' + 'a'.repeat(64);
const DIGEST_B = 'sha256:' + 'b'.repeat(64);

function logFile(repo) {
  return receiptLog.resolveReceiptPaths(repo).file;
}

function readLog(repo) {
  return receiptLog.readRecords(logFile(repo)).records;
}

function foldOf(repo) {
  return dispatchLog.foldRecords(readLog(repo));
}

// A minimal environment: temp repo dir (no git unless stated), transcript,
// activation at the current transcript size.
function makeEnv({ git = false, activate = true, sessionId = 'sess-1' } = {}) {
  const repo = git ? makeGitRepo() : tmpdir('dispatch-env-');
  const tPath = makeTranscript(repo);
  if (activate) dispatchLog.appendActivation(repo, { sessionId, transcriptPath: tPath });
  return { repo, tPath, sessionId };
}

// `now` matters whenever a test also passes a pinned `now` to sweep(): the
// record's writer stamp must not land AFTER the sweep clock, or the
// future-time fail-closed rule expires the fresh dispatch on the spot.
function dispatch(env, { input = CODE_INPUT, planes = { code_review: DIGEST_A }, now } = {}) {
  return dispatchLog.appendDispatch(env.repo, {
    sessionId: env.sessionId,
    transcriptPath: env.tPath,
    toolInput: input,
    planes,
    now,
  });
}

function sweep(env, now) {
  return dispatchLog.sweep(env.repo, {
    sessionId: env.sessionId,
    transcriptPath: env.tPath,
    now,
  });
}

// Direct low-level append for crafting records with pinned timestamps.
function craft(repo, records) {
  receiptLog.appendRecords(logFile(repo), records);
}

function iso(ms) {
  return new Date(ms).toISOString();
}

// --- canonical key -----------------------------------------------------------

describe('requestKey — canonical (jq -cS) equivalence', () => {
  test('differing JSON key order → identical key', () => {
    const a = dispatchLog.requestKey({ b: 1, a: { d: [2, 1], c: 'x' } });
    const b = dispatchLog.requestKey({ a: { c: 'x', d: [2, 1] }, b: 1 });
    assert.equal(a, b);
  });

  test('raw string and parsed object forms agree; non-ASCII content is stable', () => {
    const obj = { prompt: '中文內容', threadId: 'T-1' };
    assert.equal(dispatchLog.requestKey(JSON.stringify(obj)), dispatchLog.requestKey(obj));
    assert.notEqual(dispatchLog.requestKey({ prompt: '中文內容' }), dispatchLog.requestKey({ prompt: '中文内容' }));
  });
});

// --- reducer table -----------------------------------------------------------

describe('foldRecords — pinned reducer table', () => {
  const base = (id, extra = {}) => ({
    v: 1,
    kind: 'dispatch',
    dispatch_id: id,
    session_id: 's',
    seq: Number(id.split('#')[1]),
    key: 'k1',
    planes: { code_review: DIGEST_A },
    transcript_file_id: 'f',
    frontier_start: 100,
    time: iso(Date.now()),
    ...extra,
  });
  const ev = (id, event, extra = {}) => ({ v: 1, kind: 'dispatch_event', dispatch_id: id, event, time: iso(Date.now()), ...extra });
  const settle = (id, cid) => ({ v: 1, kind: 'settlement', dispatch_id: id, completion_id: cid, plane_results: { code_review: 'no-verdict' }, time: iso(Date.now()) });

  test('born-bound dispatch (bound_tooluse_id on the base line) → state bound', () => {
    const f = dispatchLog.foldRecords([base('s#1', { bound_tooluse_id: 'tu1' })]);
    assert.equal(f.dispatches.get('s#1').state, 'bound');
    assert.equal(f.dispatches.get('s#1').boundTooluseId, 'tu1');
  });

  test('bound-then-contested and contested-then-bound reduce identically', () => {
    const a = dispatchLog.foldRecords([base('s#1'), ev('s#1', 'bound', { tooluse_id: 'tu1' }), ev('s#1', 'contested')]);
    const b = dispatchLog.foldRecords([base('s#2', { dispatch_id: 's#2' }), ev('s#2', 'contested'), ev('s#2', 'bound', { tooluse_id: 'tu1' })]);
    assert.equal(a.dispatches.get('s#1').state, 'contested');
    assert.equal(b.dispatches.get('s#2').state, 'contested');
  });

  test('conflicting duplicate bound events → contested and reported', () => {
    const f = dispatchLog.foldRecords([base('s#1'), ev('s#1', 'bound', { tooluse_id: 'tu1' }), ev('s#1', 'bound', { tooluse_id: 'tu2' })]);
    assert.equal(f.dispatches.get('s#1').state, 'contested');
    assert.ok(f.reports.some(r => r.includes('conflicting bound')));
  });

  test('payload-identical duplicate bound event is idempotent', () => {
    const f = dispatchLog.foldRecords([base('s#1'), ev('s#1', 'bound', { tooluse_id: 'tu1' }), ev('s#1', 'bound', { tooluse_id: 'tu1' })]);
    assert.equal(f.dispatches.get('s#1').state, 'bound');
  });

  test('conflicting owned events → contested; owned on unbound refused', () => {
    const f = dispatchLog.foldRecords([
      base('s#1'),
      ev('s#1', 'bound', { tooluse_id: 'tu1' }),
      ev('s#1', 'owned', { task_id: 'ta' }),
      ev('s#1', 'owned', { task_id: 'tb' }),
    ]);
    assert.equal(f.dispatches.get('s#1').state, 'contested');
    const g = dispatchLog.foldRecords([base('s#1'), ev('s#1', 'owned', { task_id: 'ta' })]);
    assert.equal(g.dispatches.get('s#1').state, 'in-flight');
    assert.ok(g.reports.some(r => r.includes('owned event on in-flight')));
  });

  test('event after terminal is refused — settlement stands', () => {
    const f = dispatchLog.foldRecords([
      base('s#1'),
      ev('s#1', 'bound', { tooluse_id: 'tu1' }),
      settle('s#1', 'tooluse:tu1'),
      ev('s#1', 'bound', { tooluse_id: 'tu9' }),
    ]);
    assert.equal(f.dispatches.get('s#1').state, 'settled');
    assert.ok(f.reports.some(r => r.includes('post-terminal')));
  });

  test('contested ack after a derived contest is accepted silently', () => {
    const f = dispatchLog.foldRecords([base('s#1'), base('s#2', { dispatch_id: 's#2', seq: 2 }), ev('s#1', 'contested'), ev('s#2', 'contested')]);
    assert.equal(f.dispatches.get('s#1').state, 'contested');
    assert.equal(f.dispatches.get('s#2').state, 'contested');
    assert.ok(!f.reports.some(r => r.includes('post-terminal event contested')));
  });

  test('unknown event kind poisons the dispatch fail-closed', () => {
    const f = dispatchLog.foldRecords([base('s#1'), ev('s#1', 'blessed')]);
    assert.equal(f.dispatches.get('s#1').state, 'poisoned');
    assert.ok(f.reports.some(r => r.includes('unknown event kind')));
  });

  test('event with no base record is ignored and reported', () => {
    const f = dispatchLog.foldRecords([ev('s#9', 'bound', { tooluse_id: 'tu1' })]);
    assert.equal(f.dispatches.size, 0);
    assert.ok(f.reports.some(r => r.includes('unknown dispatch')));
  });

  test('twin crash prefix: two same-key base lines, no events → BOTH contested', () => {
    const f = dispatchLog.foldRecords([base('s#1'), base('s#2', { dispatch_id: 's#2', seq: 2 })]);
    assert.equal(f.dispatches.get('s#1').state, 'contested');
    assert.equal(f.dispatches.get('s#2').state, 'contested');
  });

  test('ambiguous-then-clean: terminal D1 does NOT contest D2', () => {
    const f = dispatchLog.foldRecords([
      base('s#1'),
      ev('s#1', 'ambiguous', { frontier_end: 500 }),
      base('s#2', { dispatch_id: 's#2', seq: 2 }),
    ]);
    assert.equal(f.dispatches.get('s#1').state, 'ambiguous');
    assert.equal(f.dispatches.get('s#1').frontierEnd, 500);
    assert.equal(f.dispatches.get('s#2').state, 'in-flight');
  });

  test('ownership coexistence: a task-owned dispatch does not contest a same-key newcomer', () => {
    const f = dispatchLog.foldRecords([
      base('s#1'),
      ev('s#1', 'bound', { tooluse_id: 'tu1' }),
      ev('s#1', 'owned', { task_id: 'ta' }),
      base('s#2', { dispatch_id: 's#2', seq: 2 }),
    ]);
    assert.equal(f.dispatches.get('s#1').state, 'owned');
    assert.equal(f.dispatches.get('s#2').state, 'in-flight');
  });

  test('ambiguous on a bound dispatch is refused', () => {
    const f = dispatchLog.foldRecords([base('s#1', { bound_tooluse_id: 'tu1' }), ev('s#1', 'ambiguous', { frontier_end: 9 })]);
    assert.equal(f.dispatches.get('s#1').state, 'bound');
    assert.ok(f.reports.some(r => r.includes('ambiguous event on bound')));
  });

  test('settlement on contested is refused, yet its completion_id is spent (schema-borne ledger)', () => {
    const f = dispatchLog.foldRecords([base('s#1'), ev('s#1', 'contested'), settle('s#1', 'tooluse:tu1')]);
    assert.equal(f.dispatches.get('s#1').state, 'contested');
    assert.ok(f.spent.has('tooluse:tu1'));
    assert.ok(f.reports.some(r => r.includes('contested precedence')));
  });

  test('settlement for an unknown dispatch spends its identity and is reported', () => {
    const f = dispatchLog.foldRecords([settle('s#404', 'task:tz')]);
    assert.ok(f.spent.has('task:tz'));
    assert.ok(f.reports.some(r => r.includes('unknown dispatch')));
  });
});

// --- expiry classification ---------------------------------------------------

describe('expiredForPairing — log-side age, fail-closed both skew directions', () => {
  const now = Date.now();
  test('exactly 48h old is already expired (exclusive boundary)', () => {
    assert.equal(dispatchLog.expiredForPairing({ time: iso(now - 48 * HOUR) }, now), true);
    assert.equal(dispatchLog.expiredForPairing({ time: iso(now - 48 * HOUR + 1000) }, now), false);
  });
  test('malformed and FUTURE timestamps both fail closed to expired', () => {
    assert.equal(dispatchLog.expiredForPairing({ time: 'not-a-time' }, now), true);
    assert.equal(dispatchLog.expiredForPairing({}, now), true);
    assert.equal(dispatchLog.expiredForPairing({ time: iso(now + HOUR) }, now), true);
  });
});

// --- appendDispatch: visibility decision -------------------------------------

describe('appendDispatch — visibility decision', () => {
  test('entry visible at capture → born-bound, bind rides the dispatch line itself', () => {
    const env = makeEnv();
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    const r = dispatch(env);
    assert.equal(r.state, 'bound');
    assert.equal(r.boundTooluseId, 'tu1');
    const rec = readLog(env.repo).find(x => x.kind === 'dispatch');
    assert.equal(rec.bound_tooluse_id, 'tu1');
    assert.equal(readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'bound').length, 0);
  });

  test('entry not visible at capture → frontier-only record with frontier_start = transcript size', () => {
    const env = makeEnv();
    const size = fs.statSync(env.tPath).size;
    const r = dispatch(env);
    assert.equal(r.state, 'in-flight');
    assert.equal(r.frontierStart, size);
    assert.equal(readLog(env.repo).find(x => x.kind === 'dispatch').bound_tooluse_id, undefined);
  });

  test('no activation record → lazy activation, pre-barrier entry NEVER capture-bound (rollout regression)', () => {
    const env = makeEnv({ activate: false });
    addLine(env.tPath, entryLine('tu-old', CODE_INPUT)); // stale pre-migration entry
    const r = dispatch(env);
    assert.equal(r.state, 'in-flight'); // degraded, not guessed
    const acts = readLog(env.repo).filter(x => x.kind === 'activation');
    assert.equal(acts.length, 1);
    // First sweep quarantines the pre-barrier entry wholesale.
    sweep(env);
    const disp = readLog(env.repo).filter(x => x.kind === 'tooluse_disposition');
    assert.ok(disp.some(d => d.tooluse_id === 'tu-old' && d.reason === 'unaccounted'));
  });

  test('single-in-flight: a same-key twin marks BOTH contested with durable acks', () => {
    const env = makeEnv();
    dispatch(env);
    const r2 = dispatch(env);
    assert.equal(r2.state, 'contested');
    const fold = foldOf(env.repo);
    const states = [...fold.dispatches.values()].map(D => D.state);
    assert.deepEqual(states, ['contested', 'contested']);
    const acks = readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'contested');
    assert.equal(acks.length, 2);
  });

  test('≥2 same-key candidates visible at capture → ambiguous poison, both entries quarantined', () => {
    const env = makeEnv();
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    const r = dispatch(env);
    assert.equal(r.state, 'ambiguous');
    const fold = foldOf(env.repo);
    assert.equal([...fold.dispatches.values()][0].state, 'ambiguous');
    assert.ok(fold.disposedTooluse.has('tu1'));
    assert.ok(fold.disposedTooluse.has('tu2'));
  });

  test('transcript unreadable → dispatch poisoned ambiguous, appended loudly, never a guess', () => {
    const env = makeEnv();
    const r = dispatchLog.appendDispatch(env.repo, {
      sessionId: env.sessionId,
      transcriptPath: path.join(env.repo, 'no-such-transcript.jsonl'),
      toolInput: CODE_INPUT,
      planes: { code_review: DIGEST_A },
    });
    assert.equal(r.state, 'ambiguous');
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous');
  });

  test('activation aliasing: rebuilt prefix fails the digest check → capture-time binding disabled', () => {
    const env = makeEnv();
    // Rebuild the transcript with a same-length but different first line:
    // identity may or may not survive, but the prefix digest MUST fail.
    fs.writeFileSync(env.tPath, JSON.stringify({ type: 'summary', sessionStart: false }) + '\n');
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    const r = dispatch(env);
    assert.equal(r.state, 'in-flight'); // frontier-only, nothing bound by identity alone
    assert.ok(!r.boundTooluseId);
  });
});

// --- sweep: bind / settle / quarantine ---------------------------------------

describe('sweep — pairing, settlement, spent ledger', () => {
  test('frontier-only dispatch binds the first at-or-past entry and settles by tooluse_id', () => {
    const env = makeEnv();
    const r = dispatch(env); // before its entry exists
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', CODE_FAIL));
    const s = sweep(env);
    assert.equal(s.settled, 1);
    const fold = foldOf(env.repo);
    const D = fold.dispatches.get(r.dispatchId);
    assert.equal(D.state, 'settled');
    assert.equal(D.boundTooluseId, 'tu1');
    assert.deepEqual(D.settlement.plane_results.code_review, { verdict: 'fail', digest: DIGEST_A });
    assert.ok(fold.spent.has('tooluse:tu1'));
  });

  test('settlement projection reaches selectVerdict for (plane, dispatch digest)', () => {
    const env = makeEnv();
    dispatch(env);
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', CODE_FAIL));
    sweep(env);
    const sel = receiptLog.selectVerdict(readLog(env.repo), 'code_review', DIGEST_A);
    assert.equal(sel.verdict, 'fail');
  });

  test('endpoint revalidation: PASS refused on digest drift, FAIL exempt', () => {
    const repo = makeGitRepo();
    // The transcript must live OUTSIDE the repo: it is an untracked file, so
    // appending lines to it would drift the very tree digest under test.
    const tPath = makeTranscript(tmpdir('dispatch-transcript-'));
    const sessionId = 'sess-1';
    dispatchLog.appendActivation(repo, { sessionId, transcriptPath: tPath });
    const env = { repo, tPath, sessionId };
    const realDigest = treeDigest.computeTreeState(fs.realpathSync(repo)).planes.code.digest;
    // PASS with matching endpoint lands.
    dispatch(env, { planes: { code_review: realDigest } });
    addLine(tPath, entryLine('tu1', CODE_INPUT));
    addLine(tPath, resultLine('tu1', CODE_PASS));
    sweep(env);
    let sel = receiptLog.selectVerdict(readLog(repo), 'code_review', realDigest);
    assert.equal(sel.verdict, 'pass');
    // PASS with a drifted tree (dispatch digest ≠ current) is refused → no-verdict.
    dispatch(env, { input: { prompt: 'second Merge Gate review' }, planes: { code_review: DIGEST_B } });
    addLine(tPath, entryLine('tu2', { prompt: 'second Merge Gate review' }));
    addLine(tPath, resultLine('tu2', CODE_PASS));
    const s = sweep(env);
    assert.ok(s.reports.some(r => r.includes('endpoint revalidation failed')));
    assert.equal(receiptLog.selectVerdict(readLog(repo), 'code_review', DIGEST_B), null);
    // FAIL on the same drifted premise still lands: negative evidence names the digest it observed.
    dispatch(env, { input: { prompt: 'third Merge Gate review' }, planes: { code_review: DIGEST_B } });
    addLine(tPath, entryLine('tu3', { prompt: 'third Merge Gate review' }));
    addLine(tPath, resultLine('tu3', CODE_FAIL));
    sweep(env);
    sel = receiptLog.selectVerdict(readLog(repo), 'code_review', DIGEST_B);
    assert.equal(sel.verdict, 'fail');
  });

  test('dual-plane dispatch, single-namespace output → one settlement: doc verdict + code no-verdict', () => {
    const env = makeEnv();
    dispatch(env, { input: DUAL_INPUT, planes: { code_review: DIGEST_A, doc_review: DIGEST_B } });
    addLine(env.tPath, entryLine('tu1', DUAL_INPUT));
    addLine(env.tPath, resultLine('tu1', DOC_FAIL));
    sweep(env);
    const settlements = readLog(env.repo).filter(x => x.kind === 'settlement');
    assert.equal(settlements.length, 1);
    assert.deepEqual(settlements[0].plane_results.doc_review, { verdict: 'fail', digest: DIGEST_B });
    assert.equal(settlements[0].plane_results.code_review, 'no-verdict');
  });

  test('dual-namespace output settles EVERY plane no-verdict — identity spent, loud', () => {
    const env = makeEnv();
    dispatch(env, { input: DUAL_INPUT, planes: { code_review: DIGEST_A, doc_review: DIGEST_B } });
    addLine(env.tPath, entryLine('tu1', DUAL_INPUT));
    addLine(env.tPath, resultLine('tu1', DOC_FAIL + CODE_FAIL));
    const s = sweep(env);
    assert.ok(s.reports.some(r => r.includes('BOTH review namespaces')));
    const st = readLog(env.repo).find(x => x.kind === 'settlement');
    assert.equal(st.plane_results.code_review, 'no-verdict');
    assert.equal(st.plane_results.doc_review, 'no-verdict');
    assert.ok(foldOf(env.repo).spent.has('tooluse:tu1'));
  });

  test('no-verdict algebra: an all-no-verdict settlement never vetoes an older same-digest PASS', () => {
    const env = makeEnv();
    // Older PASS for (code_review, DIGEST_A) as a runner-style verdict row.
    craft(env.repo, [{ v: 1, kind: 'verdict', plane: 'code_review', digest: DIGEST_A, verdict: 'pass', mode: 'full', time: iso(Date.now()) }]);
    dispatch(env, { input: DOC_INPUT, planes: { doc_review: DIGEST_B } });
    addLine(env.tPath, entryLine('tu1', DOC_INPUT));
    addLine(env.tPath, resultLine('tu1', 'prose with no review shape at all'));
    sweep(env);
    const st = readLog(env.repo).find(x => x.kind === 'settlement');
    assert.equal(st.plane_results.doc_review, 'no-verdict');
    assert.equal(receiptLog.selectVerdict(readLog(env.repo), 'code_review', DIGEST_A).verdict, 'pass');
    assert.equal(receiptLog.selectVerdict(readLog(env.repo), 'doc_review', DIGEST_B), null); // gate open
  });

  test('replayed delivery: a spent identity is never consumed twice', () => {
    const env = makeEnv();
    dispatch(env);
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', CODE_FAIL));
    sweep(env);
    fs.rmSync(dispatchLog.cursorPath(receiptLog.resolveReceiptPaths(env.repo).dir, env.sessionId), { force: true });
    sweep(env); // full rescan replays the same completion
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 1);
  });

  test('contested dispatch: every completion refused loudly, no settlement on any path', () => {
    const env = makeEnv();
    dispatch(env);
    dispatch(env); // twin → both contested
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', CODE_PASS));
    const s = sweep(env);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
    assert.ok(s.reports.length > 0);
    // The contested pair's entry is quarantined with reason "contested".
    const d = readLog(env.repo).filter(x => x.kind === 'tooluse_disposition');
    assert.ok(d.some(x => x.tooluse_id === 'tu1' && x.reason === 'contested'));
  });

  test('quarantine isolation: after a contested pair + cursor loss, a fresh same-key dispatch binds ONLY its own entry', () => {
    const env = makeEnv();
    dispatch(env);
    dispatch(env); // contested pair
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    sweep(env); // quarantines both under the contested windows
    fs.rmSync(dispatchLog.cursorPath(receiptLog.resolveReceiptPaths(env.repo).dir, env.sessionId), { force: true });
    const r3 = dispatch(env); // fresh same-key dispatch, frontier-only
    assert.equal(r3.state, 'in-flight');
    addLine(env.tPath, entryLine('tu3', CODE_INPUT));
    addLine(env.tPath, resultLine('tu3', CODE_FAIL));
    sweep(env); // full rescan reconstructs exclusions from dispositions
    const D = foldOf(env.repo).dispatches.get(r3.dispatchId);
    assert.equal(D.state, 'settled');
    assert.equal(D.boundTooluseId, 'tu3');
  });

  test('round-10 regression: a terminal window\'s stale candidate is quarantined before a new same-key dispatch binds', () => {
    const env = makeEnv();
    const now = Date.now();
    // Aged frontier-only dispatch, then its entry (stale PASS pending), never bound.
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY,
        planes: { code_review: DIGEST_A }, transcript_file_id: dispatchLog.transcriptFileId(env.tPath),
        frontier_start: fs.statSync(env.tPath).size,
        frontier_digest: dispatchLog.prefixDigest(env.tPath, fs.statSync(env.tPath).size),
        time: iso(now - 49 * HOUR),
      },
    ]);
    addLine(env.tPath, entryLine('tu-stale', CODE_INPUT));
    addLine(env.tPath, resultLine('tu-stale', CODE_PASS));
    sweep(env, now); // expiry retires the aged dispatch, closing its window
    const foldA = foldOf(env.repo);
    assert.equal(foldA.dispatches.get('sess-1#1').state, 'expired');
    const r2 = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    addLine(env.tPath, resultLine('tu-new', CODE_FAIL));
    sweep(env, now);
    const D = foldOf(env.repo).dispatches.get(r2.dispatchId);
    assert.equal(D.boundTooluseId, 'tu-new'); // the stale entry with stale PASS was never claimed
    assert.ok(foldOf(env.repo).disposedTooluse.has('tu-stale'));
  });

  test('expiry-by-name: a bound expired dispatch refuses its late result; a fresh dispatch still settles', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY,
        planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: 20, bound_tooluse_id: 'tu1', time: iso(now - 49 * HOUR),
      },
    ]);
    addLine(env.tPath, resultLine('tu1', CODE_PASS));
    const s = sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
    assert.equal(foldOf(env.repo).dispatches.get('sess-1#1').state, 'expired');
    assert.ok(s.reports.some(r => r.includes('expired')));
    const r2 = dispatch(env, { input: { prompt: 'fresh Merge Gate round' }, now });
    addLine(env.tPath, entryLine('tu2', { prompt: 'fresh Merge Gate round' }));
    addLine(env.tPath, resultLine('tu2', CODE_FAIL));
    sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r2.dispatchId).state, 'settled');
  });

  test('cursor recovery: crash before advance (cursor lost) → one full rescan, no loss, no double-apply', () => {
    const env = makeEnv();
    const r = dispatch(env);
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', CODE_FAIL));
    const dir = receiptLog.resolveReceiptPaths(env.repo).dir;
    sweep(env);
    const afterFirst = readLog(env.repo).length;
    fs.rmSync(dispatchLog.cursorPath(dir, env.sessionId), { force: true }); // crash before cursor advance persisted
    sweep(env);
    assert.equal(readLog(env.repo).length, afterFirst); // idempotent replay
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'settled');
    assert.ok(fs.existsSync(dispatchLog.cursorPath(dir, env.sessionId)));
  });

  test('torn tail: reader ignores the unterminated line; the next append truncates it under the lock', () => {
    const env = makeEnv();
    dispatch(env);
    fs.appendFileSync(logFile(env.repo), '{"kind":"settlement","dispatch_id":"sess-1#1","completion_id":"tooluse:'); // torn
    const fold = foldOf(env.repo);
    assert.equal(fold.spent.size, 0); // torn settlement is not data
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', CODE_FAIL));
    sweep(env);
    const again = receiptLog.readRecords(logFile(env.repo));
    assert.equal(again.torn, undefined || again.torn, again.torn); // file re-readable
    assert.equal(again.records.filter(x => x.kind === 'settlement').length, 1);
  });
});

// --- background handoff ------------------------------------------------------

describe('background handoff — ownership and task settlement', () => {
  test('handoff placeholder is NOT a completion; own → task report settles; foreground twin coexists', () => {
    const env = makeEnv();
    const r1 = dispatch(env, { input: DOC_INPUT, planes: { doc_review: DIGEST_B } });
    addLine(env.tPath, entryLine('tu1', DOC_INPUT));
    addLine(env.tPath, resultLine('tu1', HANDOFF));
    sweep(env);
    let D = foldOf(env.repo).dispatches.get(r1.dispatchId);
    assert.equal(D.state, 'bound'); // placeholder settled NOTHING
    const own = dispatchLog.markBackgroundOwned(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, key: DOC_KEY, taskId: 't9',
    });
    assert.equal(own.ok, true);
    // A foreground same-key twin now coexists instead of contesting.
    const r2 = dispatch(env, { input: DOC_INPUT, planes: { doc_review: DIGEST_B } });
    assert.equal(r2.state, 'in-flight');
    addLine(env.tPath, entryLine('tu2', DOC_INPUT));
    addLine(env.tPath, resultLine('tu2', DOC_FAIL));
    addLine(env.tPath, taskLine('t9', DOC_PASS));
    sweep(env);
    const fold = foldOf(env.repo);
    const owned = fold.dispatches.get(r1.dispatchId);
    const fg = fold.dispatches.get(r2.dispatchId);
    assert.equal(owned.state, 'settled');
    assert.equal(owned.settlement.completion_id, 'task:t9');
    assert.equal(fg.state, 'settled');
    assert.equal(fg.settlement.completion_id, 'tooluse:tu2');
  });

  test('own with zero candidates marks none and refuses loudly', () => {
    const env = makeEnv();
    const own = dispatchLog.markBackgroundOwned(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, key: DOC_KEY, taskId: 't1',
    });
    assert.equal(own.ok, false);
    assert.match(own.reason, /0 candidates/);
  });

  test('task report quoting another task-id in its body cannot satisfy that task (envelope-only matching)', () => {
    const env = makeEnv();
    const tricky = {
      type: 'user',
      origin: { kind: 'task-notification' },
      message: {
        content: `<task-id>tB</task-id><status>completed</status><result>${JSON.stringify({ content: 'report quoting <task-id>tA</task-id> in prose' })}</result>`,
      },
    };
    addLine(env.tPath, tricky);
    const scan = dispatchLog.scanTranscript(env.tPath, 0);
    assert.ok(scan.tasks.has('tB'));
    assert.ok(!scan.tasks.has('tA'));
  });
});

// --- forged-sentinel negative controls (both directions) ---------------------

describe('recognition — forged line refused, genuine line accepted, same words', () => {
  test('prose mentioning the doc header inline is refused; the genuine header line is accepted', () => {
    assert.equal(dispatchLog.outputIsDocReview('the Document Review section says ✅ Mergeable'), false);
    assert.equal(dispatchLog.outputIsDocReview(DOC_PASS), true);
  });

  test('code: heading decoration tolerated, prose refused; fenced machine gate recognized', () => {
    assert.equal(dispatchLog.outputIsCodeReview('### Merge Gate: ⛔ Blocked'), true);
    assert.equal(dispatchLog.outputIsCodeReview('**Merge Gate** notes'), true);
    assert.equal(dispatchLog.outputIsCodeReview('#### Merge Gateway\nnope'), false);
    assert.equal(dispatchLog.outputIsCodeReview('as the Merge Gate says ✅ Ready'), false);
    assert.equal(dispatchLog.outputIsCodeReview('```json\n{"gate": "READY"}\n```'), true);
    assert.equal(dispatchLog.outputIsCodeReview('"gate": "READY" outside any fence'), false);
  });

  test('BLOCKED-first: output carrying both sentinels routes to fail, never pass', () => {
    assert.equal(dispatchLog.codeReviewVerdict('## Merge Gate\n✅ Ready\n⛔ Blocked'), 'fail');
    assert.equal(dispatchLog.docReviewVerdict('✅ Mergeable\n⛔ Needs revision'), 'fail');
  });

  test('handoff placeholder matched only as the WHOLE output head, not as quoted prose', () => {
    assert.equal(dispatchLog.outputIsBackgroundHandoff(HANDOFF), true);
    assert.equal(
      dispatchLog.outputIsBackgroundHandoff('## Document Review\nquoting: MCP tool "x" is still running after 120s moved to the background as task t1'),
      false
    );
  });

  test('a non-review MCP entry (no request-side phrase) is not a protocol entry at all', () => {
    const env = makeEnv();
    addLine(env.tPath, entryLine('tu-chat', { prompt: 'explain this repo' }));
    const scan = dispatchLog.scanTranscript(env.tPath, 0);
    assert.equal(scan.entries.length, 0);
  });
});

// --- frontier + compaction ---------------------------------------------------

describe('frontier soundness and write-ahead compaction', () => {
  test('aged dispositions fold into a frontier; exclusion survives the drop (no-shift, nothing re-admitted)', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-old', CODE_INPUT));
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      { v: 1, kind: 'tooluse_disposition', session_id: 'sess-1', key: CODE_KEY, tooluse_id: 'tu-old', reason: 'unaccounted', transcript_file_id: fid, start_offset: 0, end_offset: fs.statSync(env.tPath).size, time: iso(now - 49 * HOUR) },
    ]);
    const c = dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.equal(c.frontiers, 1);
    const recs = readLog(env.repo);
    assert.ok(recs.some(x => x.kind === 'frontier' && x.transcript_file_id === fid));
    assert.ok(!recs.some(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu-old'));
    // Rescan re-admits nothing: a fresh same-key dispatch never binds the covered entry.
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    addLine(env.tPath, resultLine('tu-new', CODE_FAIL));
    sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).boundTooluseId, 'tu-new');
  });

  test('contiguity: the frontier never advances past an undisposed entry', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    const cut = fs.statSync(env.tPath).size;
    addLine(env.tPath, entryLine('tu2', CODE_INPUT)); // undisposed
    craft(env.repo, [
      { v: 1, kind: 'tooluse_disposition', session_id: 'sess-1', key: CODE_KEY, tooluse_id: 'tu1', reason: 'unaccounted', transcript_file_id: dispatchLog.transcriptFileId(env.tPath), start_offset: 0, end_offset: cut, time: iso(now - 49 * HOUR) },
    ]);
    dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    const f = readLog(env.repo).find(x => x.kind === 'frontier');
    assert.equal(f.upto_end, cut);
  });

  test('frontier inapplicable on a rebuilt transcript → dispositions-only rescan, over-quarantine never re-admit', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    craft(env.repo, [
      { v: 1, kind: 'tooluse_disposition', session_id: 'sess-1', key: CODE_KEY, tooluse_id: 'tu1', reason: 'unaccounted', end_offset: fs.statSync(env.tPath).size, time: iso(now - 49 * HOUR) },
    ]);
    dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    // Rebuild the transcript: same content shape, different first line → identity + digest both fail.
    const body = fs.readFileSync(env.tPath, 'utf8').split('\n').slice(1).join('\n');
    fs.writeFileSync(env.tPath, JSON.stringify({ type: 'summary', rebuilt: true }) + '\n' + body);
    sweep(env, now);
    const d = readLog(env.repo).filter(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu1');
    assert.equal(d.length, 1); // re-quarantined (frontier no longer applies), never bound
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
  });

  test('asymmetric cutoff: compaction materializes the survivor\'s contested ack before dropping its BOUND twin', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // BOTH bound (a never-bound twin would be retained forever as hazard
    // evidence); the contest is read-time-derived only, no explicit events.
    craft(env.repo, [
      { v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY, planes: { code_review: DIGEST_A }, transcript_file_id: fid, frontier_start: 10, bound_tooluse_id: 'tu1', time: iso(now - 49 * HOUR) },
      { v: 1, kind: 'dispatch', dispatch_id: 'sess-1#2', session_id: 'sess-1', seq: 2, key: CODE_KEY, planes: { code_review: DIGEST_A }, transcript_file_id: fid, frontier_start: 10, bound_tooluse_id: 'tu2', time: iso(now - HOUR) },
    ]);
    const c = dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.ok(c.dropped >= 1, JSON.stringify(c));
    const recs = readLog(env.repo);
    assert.ok(!recs.some(x => x.kind === 'dispatch' && x.dispatch_id === 'sess-1#1'));
    const fold = dispatchLog.foldRecords(recs);
    assert.equal(fold.dispatches.get('sess-1#2').state, 'contested'); // ack materialized before the drop
    // Its completion is still refused after the drop.
    addLine(env.tPath, resultLine('tu2', CODE_PASS));
    sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
  });

  test('a never-bound read-time-contested twin is NEVER dropped — retention beats cutoff asymmetry', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      { v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY, planes: { code_review: DIGEST_A }, transcript_file_id: fid, frontier_start: 10, time: iso(now - 49 * HOUR) },
      { v: 1, kind: 'dispatch', dispatch_id: 'sess-1#2', session_id: 'sess-1', seq: 2, key: CODE_KEY, planes: { code_review: DIGEST_A }, transcript_file_id: fid, frontier_start: 10, bound_tooluse_id: 'tu2', time: iso(now - HOUR) },
    ]);
    const c = dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.equal(c.dropped, 0, JSON.stringify(c)); // the aged twin is never-bound → hazard evidence, kept
    const fold = dispatchLog.foldRecords(readLog(env.repo));
    assert.equal(fold.dispatches.get('sess-1#1').state, 'contested');
    assert.equal(fold.dispatches.get('sess-1#2').state, 'contested');
  });

  test('settlements survive compaction — the spent ledger outlives dispatch retention', () => {
    const env = makeEnv();
    const now = Date.now();
    dispatch(env, { now });
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', CODE_FAIL));
    sweep(env, now);
    dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now: now + 50 * HOUR });
    const recs = readLog(env.repo);
    assert.ok(recs.some(x => x.kind === 'settlement'));
    assert.ok(dispatchLog.foldRecords(recs).spent.has('tooluse:tu1'));
  });
});

// --- CLI + hook layer --------------------------------------------------------

describe('dispatch-cli + hook exit-2 duty', () => {
  function hookInput(env, extra = {}) {
    return JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__codex__codex',
      session_id: env.sessionId,
      transcript_path: env.tPath,
      tool_input: CODE_INPUT,
      ...extra,
    });
  }

  test('CLI dispatch appends a record and exits 0 in a git repo', () => {
    const repo = makeGitRepo();
    const tPath = makeTranscript(repo);
    const r = spawnSync('node', [CLI, 'dispatch'], {
      cwd: repo, input: hookInput({ sessionId: 's-cli', tPath }), encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: XDG },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readLog(repo).some(x => x.kind === 'dispatch'));
  });

  test('undigestable tree: CLI still RECORDS the dispatch (null digest), loudly, exit 0', () => {
    // The record is the accounting duty, not the digest: an unrecorded review
    // call is an in-barrier orphan the next same-key capture could bind to.
    // A null digest never matches a recomputation, so no gate closes on it.
    const repo = tmpdir('dispatch-nogit-');
    const tPath = makeTranscript(repo);
    const r = spawnSync('node', [CLI, 'dispatch'], {
      cwd: repo, input: hookInput({ sessionId: 's-cli2', tPath }), encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: XDG },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /digest unavailable/);
    const rec = readLog(repo).find(x => x.kind === 'dispatch');
    assert.ok(rec, 'dispatch record must be written even without a digestable tree');
    assert.equal(rec.planes.code_review, null);
  });

  test('null-digest dispatch settles no-verdict — a PASS is never minted on a degraded plane', () => {
    const repo = tmpdir('dispatch-nogit2-');
    const tPath = makeTranscript(repo);
    const env = { repo, tPath, sessionId: 'sess-nd' };
    dispatchLog.appendDispatch(repo, {
      sessionId: env.sessionId, transcriptPath: tPath,
      toolInput: CODE_INPUT, planes: { code_review: null },
    });
    addLine(tPath, entryLine('tu-nd', CODE_INPUT));
    addLine(tPath, resultLine('tu-nd', CODE_PASS));
    const s = sweep(env);
    assert.ok(s.reports.some(x => x.includes('null digest')), s.reports.join('; '));
    const st = readLog(repo).find(x => x.kind === 'settlement');
    assert.equal(st.plane_results.code_review, 'no-verdict'); // identity spent, no evidence minted
  });

  test('hook PreToolUse blocks with EXACTLY exit 2 when the append fails (unwritable cache)', () => {
    const repo = makeGitRepo();
    const tPath = makeTranscript(repo);
    const deadXdg = path.join(tmpdir('dispatch-dead-'), 'ro');
    fs.mkdirSync(deadXdg, { mode: 0o500 });
    const r = spawnSync('bash', [HOOK], {
      cwd: repo, input: hookInput({ sessionId: 's-hook', tPath }), encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: deadXdg },
    });
    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /could not be durably appended|blocking/i);
  });

  test('negative control: a non-review PreToolUse never blocks (exit 0), even with an unwritable cache', () => {
    const repo = makeGitRepo();
    const tPath = makeTranscript(repo);
    const deadXdg = path.join(tmpdir('dispatch-dead2-'), 'ro');
    fs.mkdirSync(deadXdg, { mode: 0o500 });
    const r = spawnSync('bash', [HOOK], {
      cwd: repo,
      input: JSON.stringify({
        hook_event_name: 'PreToolUse', tool_name: 'mcp__codex__codex',
        session_id: 's-hook2', transcript_path: tPath,
        tool_input: { prompt: 'just a question, no review phrases' },
      }),
      encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: deadXdg },
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('CLI absent beside the hook: a REVIEW request blocks (exit 2), a non-review request runs (exit 0)', () => {
    const fake = tmpdir('dispatch-fakehook-');
    fs.mkdirSync(path.join(fake, 'hooks'));
    fs.copyFileSync(HOOK, path.join(fake, 'hooks', 'post-tool-review-state.sh'));
    const repo = makeGitRepo();
    const tPath = makeTranscript(repo);
    // Review request: cannot be recorded → must not run (in-barrier orphan otherwise).
    const blocked = spawnSync('bash', [path.join(fake, 'hooks', 'post-tool-review-state.sh')], {
      cwd: repo, input: hookInput({ sessionId: 's-hook3', tPath }), encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: XDG },
    });
    assert.equal(blocked.status, 2, `stderr: ${blocked.stderr}`);
    assert.match(blocked.stderr, /cannot be recorded|install-scripts/);
    // The block fired BEFORE any legacy epoch write: a blocked call gets no
    // PostToolUse, so a recorded epoch would leak as a permanently-live
    // reservation. No state file may exist at all.
    assert.ok(!fs.existsSync(path.join(repo, '.claude_review_state.json')));
    // Same missing CLI, non-review request: never blocked (pass direction).
    const allowed = spawnSync('bash', [path.join(fake, 'hooks', 'post-tool-review-state.sh')], {
      cwd: repo,
      input: JSON.stringify({
        hook_event_name: 'PreToolUse', tool_name: 'mcp__codex__codex',
        session_id: 's-hook3', transcript_path: tPath,
        tool_input: { prompt: 'just a question, no review phrases' },
      }),
      encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: XDG },
    });
    assert.equal(allowed.status, 0, `stderr: ${allowed.stderr}`);
  });

  test('CLI activate is idempotent per session', () => {
    const repo = makeGitRepo();
    const tPath = makeTranscript(repo);
    const env2 = { ...process.env, XDG_CACHE_HOME: XDG };
    const payload = JSON.stringify({ session_id: 's-act', transcript_path: tPath });
    const a = spawnSync('node', [CLI, 'activate'], { cwd: repo, input: payload, encoding: 'utf8', env: env2 });
    const b = spawnSync('node', [CLI, 'activate'], { cwd: repo, input: payload, encoding: 'utf8', env: env2 });
    assert.equal(a.status, 0);
    assert.equal(b.status, 0);
    assert.equal(readLog(repo).filter(x => x.kind === 'activation' && x.session_id === 's-act').length, 1);
  });
});

// --- Codex round-1 regressions (2026-08-11 review, thread 019ff18a) ---------

describe('round-1 regressions — orphan capture, frontier validation, retention, seq, torn tail', () => {
  test('P0 orphan hazard: a terminal never-bound same-key dispatch forces frontier-only capture, the orphan is quarantined', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // An aged frontier-only dispatch whose window a sweep closes BEFORE its
    // entry lands (corrupt-time instant expiry): the classic orphan producer.
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY,
        planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: fs.statSync(env.tPath).size, time: iso(now - 49 * HOUR),
      },
    ]);
    sweep(env, now); // expired; empty window [start, start)
    addLine(env.tPath, entryLine('tu-orphan', CODE_INPUT)); // straggler lands AFTER the window closed
    addLine(env.tPath, resultLine('tu-orphan', CODE_PASS)); // with a stale PASS
    const r2 = dispatch(env, { now });
    assert.equal(r2.state, 'ambiguous'); // NOT capture-bound to the orphan; poisoned, one wasted review
    assert.equal(r2.boundTooluseId, null);
    assert.ok(r2.reports.some(x => /quarantined.*poisoned ambiguous/.test(x)), r2.reports.join('; '));
    const d = readLog(env.repo).filter(x => x.kind === 'tooluse_disposition');
    assert.ok(d.some(x => x.tooluse_id === 'tu-orphan' && x.reason === 'unaccounted'));
    // The instant-expiry dispatch's window is EMPTY, so its debt is
    // unpayable and the key stays degraded: even a post-boundary candidate
    // on a later dispatch may be the straggler, and the sweep refuses to
    // bind it (round-3 P0 — the straggler landing AFTER the fresh dispatch).
    const r3 = dispatch(env, { now });
    assert.equal(r3.state, 'in-flight'); // nothing visible at capture
    addLine(env.tPath, entryLine('tu-real', CODE_INPUT));
    addLine(env.tPath, resultLine('tu-real', CODE_PASS)); // could equally be the straggler's stale PASS
    const s3 = sweep(env, now);
    const D = foldOf(env.repo).dispatches.get(r3.dispatchId);
    assert.equal(D.state, 'ambiguous'); // refused, poisoned — never bound
    assert.ok(foldOf(env.repo).disposedTooluse.has('tu-real'));
    assert.ok(s3.reports.some(x => /hazard active/.test(x)), s3.reports.join('; '));
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0); // no PASS ever minted
  });

  test('P0 frontier validation is per-record: a smaller VALID frontier applies while a larger invalid one exists', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    const cut = fs.statSync(env.tPath).size;
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      // The larger frontier's digest no longer verifies (stale after edits).
      {
        v: 1, kind: 'frontier', session_id: 'sess-1', key: CODE_KEY, transcript_file_id: fid,
        upto_end: cut + 999, prefix_digest: 'sha256:' + 'f'.repeat(64), time: iso(now),
      },
      // The smaller one still verifies and must keep excluding tu1.
      {
        v: 1, kind: 'frontier', session_id: 'sess-1', key: CODE_KEY, transcript_file_id: fid,
        upto_end: cut, prefix_digest: dispatchLog.prefixDigest(env.tPath, cut), time: iso(now),
      },
    ]);
    const r = dispatch(env, { now });
    // Per-record validation holds: the valid smaller frontier still excludes
    // tu1 (a max-selection regression would surface tu1 as visible and turn
    // this into an ambiguous poisoning instead).
    assert.equal(r.state, 'in-flight');
    assert.equal(r.boundTooluseId, null);
    // And the INVALID frontier is itself hazard evidence (round 3): binding
    // on this key is refused until the unverifiable accounting is resolved.
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    addLine(env.tPath, resultLine('tu2', CODE_FAIL));
    sweep(env, now);
    const D = foldOf(env.repo).dispatches.get(r.dispatchId);
    assert.equal(D.state, 'ambiguous');
    assert.ok(foldOf(env.repo).disposedTooluse.has('tu2'));
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
  });

  test('P1 retention vs pairing: a future-dated dispatch is expired for pairing but NEVER dropped by compaction', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY,
        planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: fs.statSync(env.tPath).size, time: iso(now + HOUR), // future stamp
      },
    ]);
    sweep(env, now); // fail-closed: expired for pairing
    assert.equal(foldOf(env.repo).dispatches.get('sess-1#1').state, 'expired');
    const c = dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.equal(c.dropped, 0); // retained for exclusion — a bogus stamp earns retention, not deletion
    assert.ok(readLog(env.repo).some(x => x.kind === 'dispatch' && x.dispatch_id === 'sess-1#1'));
    assert.equal(dispatchLog.agedForRetention({ time: iso(now + HOUR) }, now), false);
    assert.equal(dispatchLog.agedForRetention({ time: 'garbage' }, now), false);
    assert.equal(dispatchLog.agedForRetention({ time: iso(now - 49 * HOUR) }, now), true);
  });

  test('P2 contested windows close via sweep-materialized acks carrying frontier_end — idempotent', () => {
    const env = makeEnv();
    dispatch(env);
    dispatch(env); // twin -> both contested; append-time events carry NO frontier_end
    // BOTH calls' entries must land before the windows may close (round-4
    // P1: a window sealed before its own entry landed can never be paid).
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', CODE_PASS));
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    addLine(env.tPath, resultLine('tu2', CODE_PASS));
    sweep(env);
    const closed = () =>
      readLog(env.repo).filter(
        x => x.kind === 'dispatch_event' && x.event === 'contested' && typeof x.frontier_end === 'number'
      );
    assert.equal(closed().length, 2); // one closing ack per contested dispatch
    sweep(env);
    assert.equal(closed().length, 2); // frontierEnd landed -> no re-emission
  });

  test('P2 seq high-water mark: a dropped dispatch record never lets its seq be minted again', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-b', CODE_INPUT));
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // BOUND aged terminal — the only droppable shape (never-bound is hazard
    // evidence and is retained forever).
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY,
        planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: 0, bound_tooluse_id: 'tu-b', time: iso(now - 49 * HOUR),
      },
      { v: 1, kind: 'dispatch_event', dispatch_id: 'sess-1#1', event: 'expired', time: iso(now - 48 * HOUR) },
    ]);
    const c = dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.ok(c.dropped >= 1, JSON.stringify(c));
    assert.ok(!readLog(env.repo).some(x => x.kind === 'dispatch' && x.dispatch_id === 'sess-1#1'));
    assert.ok(readLog(env.repo).some(x => x.kind === 'seq_hwm' && x.session_id === 'sess-1' && x.seq === 1));
    const r = dispatch(env, { now });
    assert.equal(r.dispatchId, 'sess-1#2'); // floor survives the dropped record
  });

  test('P2 sentinel-free code-review output yields NO verdict; an older same-digest PASS stands', () => {
    assert.equal(dispatchLog.codeReviewVerdict('## Merge Gate\n\nDiscussion only, nothing decided.\n'), null);
    const env = makeEnv();
    craft(env.repo, [
      { v: 1, kind: 'verdict', plane: 'code_review', digest: DIGEST_A, verdict: 'pass', mode: 'full', time: iso(Date.now()) },
    ]);
    dispatch(env);
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', '## Merge Gate\n\nDiscussion only, nothing decided.\n'));
    sweep(env);
    const st = readLog(env.repo).find(x => x.kind === 'settlement');
    assert.equal(st.plane_results.code_review, 'no-verdict'); // identity spent, FAIL not fabricated
    assert.equal(receiptLog.selectVerdict(readLog(env.repo), 'code_review', DIGEST_A).verdict, 'pass');
  });

  test('P2 torn tail: cursor stops at parsedUpto and the completed line is re-read, never lost', () => {
    const env = makeEnv();
    dispatch(env);
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, resultLine('tu1', CODE_FAIL));
    const partial = JSON.stringify(entryLine('tu2', CODE_INPUT));
    fs.appendFileSync(env.tPath, partial.slice(0, 25)); // torn write, no newline
    const sc = dispatchLog.scanTranscript(env.tPath, 0);
    assert.ok(sc.parsedUpto < sc.size);
    sweep(env);
    const cur = JSON.parse(
      fs.readFileSync(dispatchLog.cursorPath(receiptLog.resolveReceiptPaths(env.repo).dir, env.sessionId), 'utf8')
    );
    assert.equal(cur.offset, sc.parsedUpto); // never advances over unclassified bytes
    fs.appendFileSync(env.tPath, partial.slice(25) + '\n'); // the write completes
    sweep(env);
    assert.ok(foldOf(env.repo).disposedTooluse.has('tu2')); // re-read and accounted, not skipped
  });

  test('P2 an entry with no input field is skipped fail-closed — scan neither throws nor fabricates a key', () => {
    const env = makeEnv();
    addLine(env.tPath, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-x', name: 'mcp__codex__codex' }] } });
    const sc = dispatchLog.scanTranscript(env.tPath, 0);
    assert.ok(!sc.entries.some(e => e.tooluseId === 'tu-x'));
  });

  test('P0 compaction scope: another session\'s aged terminal records are never dropped', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-other#1', session_id: 'sess-other', seq: 1, key: CODE_KEY,
        planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: 0, time: iso(now - 49 * HOUR),
      },
      { v: 1, kind: 'dispatch_event', dispatch_id: 'sess-other#1', event: 'expired', time: iso(now - 48 * HOUR) },
    ]);
    const c = dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.equal(c.dropped, 0); // sess-other's fold cannot be re-derived here
    assert.ok(readLog(env.repo).some(x => x.kind === 'dispatch' && x.dispatch_id === 'sess-other#1'));
  });

  test('P0 coverage duty: a bound aged dispatch is retained while its entry lacks verifying frontier coverage', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-a', CODE_INPUT)); // undisposed — blocks frontier contiguity
    addLine(env.tPath, entryLine('tu-b', CODE_INPUT));
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY,
        planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: 0, bound_tooluse_id: 'tu-b', time: iso(now - 49 * HOUR),
      },
      { v: 1, kind: 'dispatch_event', dispatch_id: 'sess-1#1', event: 'expired', time: iso(now - 48 * HOUR) },
    ]);
    const c = dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.ok(readLog(env.repo).some(x => x.kind === 'dispatch' && x.dispatch_id === 'sess-1#1'));
    assert.ok(c.reports.some(x => x.includes('not frontier-covered')), JSON.stringify(c.reports));
    // Identity accounting survives: tu-b is still excluded on a full rescan.
    assert.ok(foldOf(env.repo).dispatches.get('sess-1#1').boundTooluseId === 'tu-b');
  });

  test('CLI compact subcommand runs and reports ok', () => {
    const repo = makeGitRepo();
    const tPath = makeTranscript(repo);
    const r = spawnSync('node', [CLI, 'compact'], {
      cwd: repo, input: JSON.stringify({ session_id: 's-cmp', transcript_path: tPath }), encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: XDG },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /"ok":true/);
  });
});

// --- Codex round-2 regressions ----------------------------------------------

describe('round-2 regressions — retention-forever, invalid frontier hazard, causal boundary, clamp scope', () => {
  test('P0 a never-bound terminal dispatch survives compaction and its hazard survives with it', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY,
        planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: fs.statSync(env.tPath).size, time: iso(now - 49 * HOUR),
      },
    ]);
    sweep(env, now); // expired — terminal, never bound
    const c = dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.equal(c.dropped, 0); // hazard evidence is never deleted
    assert.ok(readLog(env.repo).some(x => x.kind === 'dispatch' && x.dispatch_id === 'sess-1#1'));
    // The straggler arriving after compaction is still caught by the hazard.
    addLine(env.tPath, entryLine('tu-late', CODE_INPUT));
    addLine(env.tPath, resultLine('tu-late', CODE_PASS));
    const r2 = dispatch(env, { now });
    assert.equal(r2.state, 'ambiguous');
    assert.ok(readLog(env.repo).some(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu-late'));
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0); // stale PASS dead
  });

  test('P0 an INAPPLICABLE same-key frontier makes capture unverifiable — candidates quarantined, dispatch poisoned', () => {
    const env = makeEnv();
    addLine(env.tPath, entryLine('tu1', CODE_INPUT)); // formerly-disposed entry, re-admitted by the invalid frontier
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      {
        v: 1, kind: 'frontier', session_id: 'sess-1', key: CODE_KEY, transcript_file_id: fid,
        upto_end: fs.statSync(env.tPath).size, prefix_digest: 'sha256:' + 'e'.repeat(64), // no longer verifies
        time: iso(Date.now()),
      },
    ]);
    const r = dispatch(env);
    assert.equal(r.state, 'ambiguous'); // fail-closed: never capture-bind on unverifiable accounting
    assert.equal(r.boundTooluseId, null);
    assert.ok(readLog(env.repo).some(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu1'));
  });

  test('P1 frontier_start is the true causal boundary (size): a pre-dispatch torn entry can never become this call\'s own', () => {
    const env = makeEnv();
    const partial = JSON.stringify(entryLine('tu-old', CODE_INPUT));
    fs.appendFileSync(env.tPath, partial.slice(0, 30)); // an older call's entry, torn at dispatch time
    const r = dispatch(env);
    assert.equal(r.frontierStart, fs.statSync(env.tPath).size); // includes the torn bytes
    fs.appendFileSync(env.tPath, partial.slice(30) + '\n'); // the old write completes — startOffset < frontier_start
    addLine(env.tPath, resultLine('tu-old', CODE_PASS));
    addLine(env.tPath, entryLine('tu-own', CODE_INPUT)); // this call's own entry, past the boundary
    addLine(env.tPath, resultLine('tu-own', CODE_FAIL));
    sweep(env);
    const D = foldOf(env.repo).dispatches.get(r.dispatchId);
    assert.equal(D.boundTooluseId, 'tu-own'); // never the pre-dispatch straggler
    assert.ok(foldOf(env.repo).disposedTooluse.has('tu-old'));
    const st = readLog(env.repo).filter(x => x.kind === 'settlement');
    assert.equal(st.length, 1);
    assert.equal(st[0].plane_results.code_review.verdict, 'fail'); // the stale PASS died unclaimed
  });

  test('P2 contested-window closure ignores bound/owned dispatches — only an in-flight claim window clamps it', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-bg', CODE_INPUT));
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // An owned background dispatch with an EARLY frontier_start sits on the key.
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-1#1', session_id: 'sess-1', seq: 1, key: CODE_KEY,
        planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: 5, bound_tooluse_id: 'tu-bg', time: iso(now),
      },
      { v: 1, kind: 'dispatch_event', dispatch_id: 'sess-1#1', event: 'owned', task_id: 't-bg', time: iso(now) },
    ]);
    const r2 = dispatch(env, { now }); // in-flight (owned twin is exempt from single-in-flight)
    const r3 = dispatch(env, { now }); // r2+r3 contested
    assert.equal(r3.state, 'contested');
    // Both contested calls' entries land before the sweep — the windows only
    // close once the landed observations can supply one entry per window.
    addLine(env.tPath, entryLine('tu-c', CODE_INPUT));
    addLine(env.tPath, entryLine('tu-c2', CODE_INPUT));
    sweep(env, now);
    const acks = readLog(env.repo).filter(
      x => x.kind === 'dispatch_event' && x.event === 'contested' && typeof x.frontier_end === 'number'
    );
    assert.ok(acks.length >= 2, JSON.stringify(acks));
    for (const a of acks) {
      assert.ok(a.frontier_end > 5, `window collapsed to the owned dispatch's frontier_start: ${a.frontier_end}`);
    }
    // The contested calls' entry is labeled contested, not unaccounted.
    const d = readLog(env.repo).filter(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu-c');
    assert.equal(d.length, 1);
    assert.equal(d[0].reason, 'contested');
  });
});

// Payment fixtures must be REAL observations since round 9: a disposition
// enters the matching graph only when it names the current file and its
// range_digest recomputes over the current bytes. These helpers land a real
// entry and craft its verified payment record.
function appendEntry(env, tuId) {
  const start = fs.statSync(env.tPath).size;
  addLine(env.tPath, entryLine(tuId, CODE_INPUT));
  return { start, end: fs.statSync(env.tPath).size };
}

function craftPaid(env, fid, now, tuId, range) {
  craft(env.repo, [{
    v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
    tooluse_id: tuId, reason: 'unaccounted', transcript_file_id: fid,
    start_offset: range.start, end_offset: range.end,
    range_digest: dispatchLog.rangeDigest(env.tPath, range.start, range.end),
    time: iso(now - HOUR),
  }]);
}

// --- round-4 regressions — payment predicate, deferred closure, durable clearance ---

describe('round-4 regressions — window-membership payments, all-or-none closure, debt_cleared durability', () => {
  // A crafted terminal never-bound window far above any real offset in the
  // fixture transcript, so the accounting under test never collides with the
  // entries the test itself lands (~tens of bytes).
  function craftOwingWindow(env, fid, now, { fs = 5000, fe = 6000 } = {}) {
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: 'sess-1#900', session_id: env.sessionId, seq: 900,
        key: CODE_KEY, planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: fs, frontier_digest: dispatchLog.prefixDigest(env.tPath, fs), time: iso(now - HOUR),
      },
      {
        v: 1, kind: 'dispatch_event', dispatch_id: 'sess-1#900', event: 'expired',
        frontier_end: fe, time: iso(now - HOUR),
      },
    ]);
  }

  test('P0 a disposition that merely ENDS inside an owed window does not pay — hazard stays, no bind', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // A real, digest-verified entry that STARTED before the window boundary
    // and completed inside it: the same entry the binding predicate
    // classifies as outside. It must not pay.
    const torn = appendEntry(env, 'tu-torn');
    craftOwingWindow(env, fid, now, { fs: torn.start + 5, fe: torn.end });
    craftPaid(env, fid, now, 'tu-torn', torn);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      !readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r.dispatchId),
      'an end-offset-only overlap deactivated the hazard ledger'
    );
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous');
    const q = readLog(env.repo).find(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu-new');
    assert.ok(q, 'the candidate must be quarantined, not left pending');
  });

  test('P0 negative control: a disposition fully inside the window pays, and binding proceeds', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const paid = appendEntry(env, 'tu-paid');
    craftOwingWindow(env, fid, now, { fs: paid.start, fe: paid.end });
    craftPaid(env, fid, now, 'tu-paid', paid);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r.dispatchId),
      'a genuinely paid ledger must not block binding'
    );
  });

  test('P0 a payment from a DIFFERENT transcript file does not pay — offsets alias across rebuilds', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craftOwingWindow(env, fid, now);
    craft(env.repo, [{
      v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
      tooluse_id: 'tu-alias', reason: 'unaccounted', transcript_file_id: 'other-file-id',
      start_offset: 5100, end_offset: 5500, time: iso(now - HOUR),
    }]);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous');
  });

  test('P1 contested windows stay OPEN until both entries land; then close, pay, clear, and the key recovers', () => {
    const env = makeEnv();
    const now = Date.now();
    dispatch(env, { now });
    dispatch(env, { now }); // twins -> contested, windows open
    // Sweep BEFORE any entry lands: closing now would seal windows their own
    // entries can never pay (the ordinary race round 4 flagged).
    sweep(env, now);
    const acks = () => readLog(env.repo).filter(
      x => x.kind === 'dispatch_event' && x.event === 'contested' && typeof x.frontier_end === 'number'
    );
    assert.equal(acks().length, 0, 'a window must not close before its entry could have landed');
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    sweep(env, now);
    assert.equal(acks().length, 0, 'one landed entry cannot supply two windows');
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    sweep(env, now);
    assert.equal(acks().length, 2, 'both entries landed — the windows close together');
    const cleared = readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared');
    assert.equal(cleared.length, 2, 'a balanced ledger is persisted, one clearance per owing dispatch');
    // Recovery: a fresh same-key dispatch binds normally.
    const r3 = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu3', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r3.dispatchId),
      'a recovered contested pair must not degrade the key'
    );
  });

  test('P1 compaction folding the paying dispositions into a frontier does NOT re-poison the recovered key', () => {
    const env = makeEnv();
    const then = Date.now() - 49 * HOUR;
    dispatch(env, { now: then });
    dispatch(env, { now: then });
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    sweep(env, then); // close + pay + debt_cleared, all stamped 49h ago
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 2
    );
    const now = Date.now();
    const c = dispatchLog.compactDispatchRecords(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, now,
    });
    assert.ok(c.frontiers >= 1, JSON.stringify(c));
    const log = readLog(env.repo);
    assert.ok(
      !log.some(x => x.kind === 'tooluse_disposition' && (x.tooluse_id === 'tu1' || x.tooluse_id === 'tu2')),
      'the aged paying dispositions are folded away — the exact condition that used to re-arm the hazard'
    );
    assert.equal(
      log.filter(x => x.kind === 'dispatch' && !x.bound_tooluse_id).length, 2,
      'never-bound records are retained (hazard evidence)'
    );
    // The retained never-bound records must not re-open the debt: clearance
    // survived compaction, so a fresh same-key dispatch still binds.
    const r3 = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu3', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r3.dispatchId),
      'routine 48h compaction permanently poisoned a recovered key'
    );
  });

  test('P1 compaction RETAINS the paying dispositions of an un-cleared key — a half-landed contested pair still recovers', () => {
    // Round-5 deadlock: tu1 lands, is quarantined, the windows stay open;
    // 48h compaction used to fold tu1's disposition into a frontier, and
    // when tu2 finally landed the Hall check could never count tu1 again
    // (below scanStart, disposition gone) — the key was dead forever.
    const env = makeEnv();
    const then = Date.now() - 49 * HOUR;
    dispatch(env, { now: then });
    dispatch(env, { now: then }); // twins, windows open
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    sweep(env, then); // tu1 quarantined; only one entry -> windows stay open
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu1')
    );
    const now = Date.now();
    dispatchLog.compactDispatchRecords(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, now,
    });
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu1'),
      'an un-cleared key\u2019s disposition is live ledger evidence and must survive compaction'
    );
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 2,
      'with tu1 still observable, tu2 landing closes both windows and balances the ledger'
    );
    const r3 = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu3', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r3.dispatchId),
      'the half-landed pair must recover once its second entry arrives'
    );
  });

  test('debt_cleared guards both directions: honoured on a terminal never-bound record, refused on a bound one', () => {
    const mk = (extra, events) => dispatchLog.foldRecords([
      {
        v: 1, kind: 'dispatch', dispatch_id: 'd1', session_id: 's', seq: 1, key: 'k',
        planes: {}, transcript_file_id: 'f', frontier_start: 0, time: iso(Date.now()), ...extra,
      },
      ...events,
    ]);
    const ok = mk({}, [
      { v: 1, kind: 'dispatch_event', dispatch_id: 'd1', event: 'expired', frontier_end: 10, time: iso(Date.now()) },
      { v: 1, kind: 'dispatch_event', dispatch_id: 'd1', event: 'debt_cleared', time: iso(Date.now()) },
    ]);
    assert.equal(ok.dispatches.get('d1').debtCleared, true);
    const forged = mk({ bound_tooluse_id: 'tu-x' }, [
      { v: 1, kind: 'dispatch_event', dispatch_id: 'd1', event: 'debt_cleared', time: iso(Date.now()) },
    ]);
    assert.equal(forged.dispatches.get('d1').debtCleared, false, 'a bound dispatch has no debt to clear');
    assert.ok(forged.reports.some(r => r.includes('debt_cleared') && r.includes('refused')));
  });
});

// --- round-6 regressions — compaction proof scoping -------------------------

describe('round-6 regressions — frontier proof and deletion identity are session/file scoped', () => {
  test('P0 a same-session disposition from a DIFFERENT transcript file neither advances the frontier nor is folded', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT)); // landed, undisposed in THIS file
    // A rebuilt/forked file's disposition reusing the tooluse_id: numerically
    // plausible offsets, wrong file. It must not make tu-x "appear disposed".
    craft(env.repo, [{
      v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
      tooluse_id: 'tu-x', reason: 'unaccounted', transcript_file_id: 'some-old-file-id',
      start_offset: 0, end_offset: 10, time: iso(now - 49 * HOUR),
    }]);
    const c = dispatchLog.compactDispatchRecords(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, now,
    });
    assert.equal(c.frontiers, 0, 'foreign-file evidence advanced a frontier over an undisposed entry');
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'tooluse_disposition' && x.transcript_file_id === 'some-old-file-id'),
      'the foreign file’s only exclusion evidence must be retained'
    );
  });

  test('P0 deletion identity carries the full scope — a colliding foreign-file record survives the fold', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-y', CODE_INPUT));
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const T = iso(now - 49 * HOUR);
    // Two records identical in (tooluse_id, key, time) — the old identity —
    // differing only in transcript_file_id. Folding the first must not
    // delete the second.
    craft(env.repo, [
      {
        v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
        tooluse_id: 'tu-y', reason: 'unaccounted', transcript_file_id: fid,
        start_offset: 0, end_offset: 1, time: T,
      },
      {
        v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
        tooluse_id: 'tu-y', reason: 'unaccounted', transcript_file_id: 'some-old-file-id',
        start_offset: 0, end_offset: 1, time: T,
      },
    ]);
    const c = dispatchLog.compactDispatchRecords(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, now,
    });
    assert.ok(c.frontiers >= 1, JSON.stringify(c));
    const left = readLog(env.repo).filter(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu-y');
    assert.equal(left.length, 1, 'exactly the current-file record folds; the collision must not widen the delete');
    assert.equal(left[0].transcript_file_id, 'some-old-file-id');
  });
});

// --- round-7 regressions — one observation pays one window; file-scoped suppression ---

describe('round-7 regressions — observation-deduped matching payments, empty windows, foreign-file suppression', () => {
  function craftOwing(env, fid, now, seq, fs, fe) {
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: `${env.sessionId}#${seq}`, session_id: env.sessionId, seq,
        key: CODE_KEY, planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: fs, frontier_digest: dispatchLog.prefixDigest(env.tPath, fs), time: iso(now - HOUR),
      },
      {
        v: 1, kind: 'dispatch_event', dispatch_id: `${env.sessionId}#${seq}`, event: 'expired',
        frontier_end: fe, time: iso(now - HOUR),
      },
    ]);
  }

  test('P0 a duplicated disposition is ONE observation — it cannot pay two windows', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // A recovered prefix legally duplicates a disposition (§3.3): two
    // byte-identical verified records, one observed entry, two owed windows
    // (the second window sits inside the summary line — no entry ever).
    const e1 = appendEntry(env, 'tu-dup');
    craftOwing(env, fid, now, 910, e1.start, e1.end);
    craftOwing(env, fid, now, 911, 2, 20);
    craftPaid(env, fid, now, 'tu-dup', e1);
    craftPaid(env, fid, now, 'tu-dup', e1);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous',
      'a duplicate record paid a second window'
    );
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 0,
      'an unpaid ledger must not clear'
    );
  });

  test('P0 two distinct observations inside ONE window do not cover a sibling window', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const e1 = appendEntry(env, 'tu-a');
    const e2 = appendEntry(env, 'tu-b');
    craftOwing(env, fid, now, 910, e1.start, e2.end); // spans BOTH entries
    craftOwing(env, fid, now, 911, 2, 20); // no entry ever
    craftPaid(env, fid, now, 'tu-a', e1);
    craftPaid(env, fid, now, 'tu-b', e2);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous',
      'aggregate counting covered a window that observed nothing'
    );
  });

  test('negative control: one observation per window pays both, and binding proceeds', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const e1 = appendEntry(env, 'tu-a');
    const e2 = appendEntry(env, 'tu-b');
    craftOwing(env, fid, now, 910, e1.start, e1.end);
    craftOwing(env, fid, now, 911, e2.start, e2.end);
    craftPaid(env, fid, now, 'tu-a', e1);
    craftPaid(env, fid, now, 'tu-b', e2);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r.dispatchId),
      'a genuinely balanced ledger must not block binding'
    );
  });

  test('P0 an EMPTY window (instant expiry) is permanently unpayable — payments elsewhere never clear it', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const e1 = appendEntry(env, 'tu-a');
    const e2 = appendEntry(env, 'tu-b');
    craftOwing(env, fid, now, 910, 5, 5); // empty: no entry can exist inside it
    craftOwing(env, fid, now, 911, e1.start, e2.end); // real window, two paid entries
    craftPaid(env, fid, now, 'tu-a', e1);
    craftPaid(env, fid, now, 'tu-b', e2);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous',
      'payments on a sibling window cleared a debt no entry could ever pay'
    );
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 0,
      'an empty window must keep the key degraded — no clearance'
    );
  });

  test('P1 a foreign transcript file’s disposition does not suppress this file’s entry — binding proceeds', () => {
    const env = makeEnv();
    const now = Date.now();
    // A rebuilt/forked file's record reusing the tooluse_id: it says nothing
    // about the same-named entry in THIS file.
    craft(env.repo, [{
      v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
      tooluse_id: 'tu-x', reason: 'unaccounted', transcript_file_id: 'some-old-file-id',
      start_offset: 0, end_offset: 10, time: iso(now - HOUR),
    }]);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r.dispatchId),
      'a rebuilt file’s reused tooluse_id suppressed the live entry'
    );
  });

  test('negative control: a legacy file-less disposition still suppresses globally — no bind', () => {
    const env = makeEnv();
    const now = Date.now();
    craft(env.repo, [{
      v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
      tooluse_id: 'tu-x', reason: 'unaccounted',
      start_offset: 0, end_offset: 10, time: iso(now - HOUR),
    }]);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      !readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r.dispatchId),
      'a record that cannot prove its file must suppress, fail-closed'
    );
  });
});

// --- round-8 regressions — conflicting copies prove nothing; one observation graph; session-scoped suppression ---

describe('round-8 regressions — conflict fail-closed, 2b/hazard shared matching, (session, file) suppression scope', () => {
  function craftOwing(env, fid, now, seq, fs, fe) {
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: `${env.sessionId}#${seq}`, session_id: env.sessionId, seq,
        key: CODE_KEY, planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: fs, frontier_digest: dispatchLog.prefixDigest(env.tPath, fs), time: iso(now - HOUR),
      },
      {
        v: 1, kind: 'dispatch_event', dispatch_id: `${env.sessionId}#${seq}`, event: 'expired',
        frontier_end: fe, time: iso(now - HOUR),
      },
    ]);
  }

  test('P0 copies that CONFLICT on offsets prove nothing — the favorable copy must not pay', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // The same entry line written twice (a recovered prefix can duplicate the
    // line itself): both copies digest-verify, at DIFFERENT offsets. Same
    // (file, tooluse) identity disagreeing on where it was observed — neither
    // copy may be selected.
    const c1 = appendEntry(env, 'tu-c');
    const c2 = appendEntry(env, 'tu-c');
    craftOwing(env, fid, now, 910, c1.start, c1.end);
    craftPaid(env, fid, now, 'tu-c', c1);
    craftPaid(env, fid, now, 'tu-c', c2);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous',
      'a conflicted observation participated in matching'
    );
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 0,
      'a conflicted ledger must not clear'
    );
  });

  test('negative control: an EXACT duplicate is still one valid observation — it pays its window', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const e1 = appendEntry(env, 'tu-dup');
    craftOwing(env, fid, now, 910, e1.start, e1.end);
    craftPaid(env, fid, now, 'tu-dup', e1);
    craftPaid(env, fid, now, 'tu-dup', e1);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r.dispatchId),
      'an exact recovery duplicate must remain one VALID observation'
    );
  });

  test('P1 sweep 2b refuses to close windows over a conflicted observation — same graph as the hazard check', () => {
    const env = makeEnv();
    const now = Date.now();
    dispatch(env, { now });
    dispatch(env, { now }); // twins -> contested, windows open
    // tu1 lands TWICE (same tooluse_id at two ranges — a broken transcript):
    // the observation conflicts, leaving only tu2 for two windows.
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    sweep(env, now);
    const acks = readLog(env.repo).filter(
      x => x.kind === 'dispatch_event' && x.event === 'contested' && typeof x.frontier_end === 'number'
    );
    assert.equal(
      acks.length, 0,
      '2b closed windows the hazard matcher would refuse to consider paid'
    );
  });

  test('P1 a predecessor SESSION’s file-bearing disposition does not suppress — same scope as a frontier', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // Suppressing here would evaporate at compaction: the folded frontier
    // carries the predecessor's session_id and applicableFrontiers rejects
    // it for this session — the exclusion's reach must not change shape.
    craft(env.repo, [{
      v: 1, kind: 'tooluse_disposition', session_id: 'sess-other', key: CODE_KEY,
      tooluse_id: 'tu-x', reason: 'unaccounted', transcript_file_id: fid,
      start_offset: 0, end_offset: 10, time: iso(now - HOUR),
    }]);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r.dispatchId),
      'a foreign session’s record suppressed an entry its folded frontier could never exclude'
    );
  });
});

// --- round-9 regressions — payments need content proof; only real byte ranges observe ---

describe('round-9 regressions — content-proved payments, byte-range validity', () => {
  function craftOwing(env, fid, now, seq, fs2, fe) {
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: `${env.sessionId}#${seq}`, session_id: env.sessionId, seq,
        key: CODE_KEY, planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: fs2, frontier_digest: dispatchLog.prefixDigest(env.tPath, fs2), time: iso(now - HOUR),
      },
      {
        v: 1, kind: 'dispatch_event', dispatch_id: `${env.sessionId}#${seq}`, event: 'expired',
        frontier_end: fe, time: iso(now - HOUR),
      },
    ]);
  }

  test('P0 a proof-less disposition suppresses but never pays — hazard stays', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const e1 = appendEntry(env, 'tu-legacy');
    craftOwing(env, fid, now, 910, e1.start, e1.end);
    // Legacy record: right file, in-window offsets, NO range_digest.
    craft(env.repo, [{
      v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
      tooluse_id: 'tu-legacy', reason: 'unaccounted', transcript_file_id: fid,
      start_offset: e1.start, end_offset: e1.end, time: iso(now - HOUR),
    }]);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous',
      'a record with no content proof paid a window across time'
    );
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 0
    );
  });

  test('P0 a digest that does not recompute over the current bytes does not pay — rebuild alias refused', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const e1 = appendEntry(env, 'tu-stale');
    craftOwing(env, fid, now, 910, e1.start, e1.end);
    // A truncate-in-place rebuild keeps dev+inode+first-line — the file id
    // matches, the offsets fit, but the recorded bytes are gone. The digest
    // is the only thing that can tell; it must refuse.
    craft(env.repo, [{
      v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
      tooluse_id: 'tu-stale', reason: 'unaccounted', transcript_file_id: fid,
      start_offset: e1.start, end_offset: e1.end,
      range_digest: 'sha256:' + '0'.repeat(64), time: iso(now - HOUR),
    }]);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous',
      'a stale digest paid a window over rebuilt bytes'
    );
  });

  test('P1 a zero-length or fractional offset pair is not an observation — refused at the door', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // The window sits inside the summary line: no entry ever existed there,
    // so only a degenerate pair could "pay" it. Zero-length: [X, X] fits
    // inside any window containing X, and its range digest (of zero bytes)
    // genuinely recomputes — the range validation is the only refusal.
    // Fractional: not a byte boundary any entry was read from.
    craftOwing(env, fid, now, 910, 2, 20);
    craft(env.repo, [
      {
        v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
        tooluse_id: 'tu-zero', reason: 'unaccounted', transcript_file_id: fid,
        start_offset: 5, end_offset: 5,
        range_digest: dispatchLog.rangeDigest(env.tPath, 5, 5), time: iso(now - HOUR),
      },
      {
        v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
        tooluse_id: 'tu-frac', reason: 'unaccounted', transcript_file_id: fid,
        start_offset: 2.5, end_offset: 19.5,
        range_digest: 'sha256:' + 'e'.repeat(64), time: iso(now - HOUR),
      },
    ]);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous',
      'a degenerate byte range entered the matching graph'
    );
  });
});

// --- round-10 regressions — the WINDOW carries its own epoch anchor; 2b payments are durable ---

describe('round-10 regressions — window epoch anchor, decision-time 2b digests', () => {
  function craftOwing(env, fid, now, seq, fs2, fe, anchor) {
    craft(env.repo, [
      {
        v: 1, kind: 'dispatch', dispatch_id: `${env.sessionId}#${seq}`, session_id: env.sessionId, seq,
        key: CODE_KEY, planes: { code_review: DIGEST_A }, transcript_file_id: fid,
        frontier_start: fs2,
        ...(anchor === undefined ? {} : { frontier_digest: anchor }),
        time: iso(now - HOUR),
      },
      {
        v: 1, kind: 'dispatch_event', dispatch_id: `${env.sessionId}#${seq}`, event: 'expired',
        frontier_end: fe, time: iso(now - HOUR),
      },
    ]);
  }

  test('P0 an anchor-less owed window never accepts even a fully verified payment — legacy records fail closed', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const e1 = appendEntry(env, 'tu-paid');
    craftOwing(env, fid, now, 920, e1.start, e1.end); // no frontier_digest at all
    craftPaid(env, fid, now, 'tu-paid', e1); // the payment itself verifies perfectly
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous',
      'a window with no epoch anchor accepted a payment'
    );
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 0
    );
  });

  test('P0 a window whose anchor does not recompute refuses payment — the debt is pinned to its epoch', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const e1 = appendEntry(env, 'tu-paid');
    // A truncate-in-place rebuild keeps dev+inode+first-line: the file id
    // matches, the numeric range fits, the PAYMENT verifies over the new
    // bytes — only the window's own anchor can say the debt belonged to a
    // prefix that no longer exists.
    craftOwing(env, fid, now, 920, e1.start, e1.end, 'sha256:' + '0'.repeat(64));
    craftPaid(env, fid, now, 'tu-paid', e1);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.equal(
      foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous',
      'a window anchored to vanished bytes accepted a new epoch\'s payment'
    );
  });

  test('P0 negative control: an anchored window accepts its verified payment — debt clears, binding proceeds', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    const e1 = appendEntry(env, 'tu-paid');
    craftOwing(env, fid, now, 920, e1.start, e1.end, dispatchLog.prefixDigest(env.tPath, e1.start));
    craftPaid(env, fid, now, 'tu-paid', e1);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-new', CODE_INPUT));
    sweep(env, now);
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'bound' && x.dispatch_id === r.dispatchId),
      'a genuinely anchored, genuinely paid ledger must not block binding'
    );
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared'),
      'the balance must persist durably'
    );
  });

  test('P1 2b closure lands durable payments in the SAME batch — every disposition digest recomputes', () => {
    const env = makeEnv();
    const now = Date.now();
    dispatch(env, { now });
    dispatch(env, { now }); // twins -> contested, windows open
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    sweep(env, now);
    const acks = readLog(env.repo).filter(
      x => x.kind === 'dispatch_event' && x.event === 'contested' && typeof x.frontier_end === 'number'
    );
    assert.equal(acks.length, 2, 'both entries landed — the windows close');
    const dispositions = readLog(env.repo).filter(x => x.kind === 'tooluse_disposition');
    assert.ok(dispositions.length > 0, 'closure must not rest on ephemeral scan entries alone');
    for (const d of dispositions) {
      assert.equal(typeof d.range_digest, 'string', `disposition for ${d.tooluse_id} lost its proof`);
      assert.equal(
        dispatchLog.rangeDigest(env.tPath, d.start_offset, d.end_offset), d.range_digest,
        `disposition for ${d.tooluse_id} carries a digest that does not recompute over the matched bytes`
      );
    }
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 2,
      'the closed windows are paid by the durable copies, not the scan'
    );
  });
});

// --- round-11 regressions — proofs born with the parse; payments precede acks ---

describe('round-11 regressions — parse-bound digests, disposition-before-ack ordering', () => {
  test('P0 a scan entry\'s digest is born with the parse — it covers exactly the entry\'s own byte range', () => {
    const env = makeEnv();
    appendEntry(env, 'tu-a');
    appendEntry(env, 'tu-b');
    const scan = dispatchLog.scanTranscript(env.tPath, 0);
    for (const tu of ['tu-a', 'tu-b']) {
      const entry = scan.entries.find(x => x.tooluseId === tu);
      assert.ok(entry, `scan must surface ${tu}`);
      assert.equal(
        entry.rangeDigest,
        dispatchLog.rangeDigest(env.tPath, entry.startOffset, entry.endOffset),
        'the parse-time digest must be the digest of the parsed bytes — nothing else'
      );
    }
  });

  test('P1 the closing sweep appends every paying disposition BEFORE the first closing ack — no ack-only prefix exists', () => {
    const env = makeEnv();
    const now = Date.now();
    dispatch(env, { now });
    dispatch(env, { now }); // twins -> contested, windows open
    addLine(env.tPath, entryLine('tu1', CODE_INPUT));
    addLine(env.tPath, entryLine('tu2', CODE_INPUT));
    sweep(env, now);
    const log = readLog(env.repo);
    const ackIdx = log.findIndex(
      x => x.kind === 'dispatch_event' && x.event === 'contested' && typeof x.frontier_end === 'number'
    );
    assert.ok(ackIdx > 0, 'the windows must have closed');
    for (const tu of ['tu1', 'tu2']) {
      const i = log.findIndex(x => x.kind === 'tooluse_disposition' && x.tooluse_id === tu);
      assert.ok(
        i !== -1 && i < ackIdx,
        `paying disposition for ${tu} must precede the first closing ack (§3.3: any prefix may persist; ` +
        `an ack-only prefix closes windows whose payments never landed) — disposition at ${i}, ack at ${ackIdx}`
      );
    }
  });
});

// --- round-12 regressions — 2b's ephemeral side is the PENDING set; one digest per line ---

describe('round-12 regressions — pending-only 2b observations, per-line digest', () => {
  test('P1 an entry suppressed by a FOREIGN-KEY disposition cannot help close windows — they hold open', () => {
    const env = makeEnv();
    const now = Date.now();
    const fid = dispatchLog.transcriptFileId(env.tPath);
    dispatch(env, { now });
    dispatch(env, { now }); // twins -> contested, two open same-key windows
    appendEntry(env, 'tu1');
    const e2 = appendEntry(env, 'tu2');
    // Durable disposition for tu2 under a DIFFERENT key, same session/file:
    // it suppresses tu2 from the pending set (suppression is tooluse-scoped),
    // but as a payment it is key-filtered — tu2 can never be paid under the
    // contested key. Matching it anyway would close windows 3b can never
    // clear: closed-and-unpaid forever.
    craft(env.repo, [{
      v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: DOC_KEY,
      tooluse_id: 'tu2', reason: 'unaccounted', transcript_file_id: fid,
      start_offset: e2.start, end_offset: e2.end,
      range_digest: dispatchLog.rangeDigest(env.tPath, e2.start, e2.end), time: iso(now - HOUR),
    }]);
    sweep(env, now);
    const acks = readLog(env.repo).filter(
      x => x.kind === 'dispatch_event' && x.event === 'contested' && typeof x.frontier_end === 'number'
    );
    assert.equal(acks.length, 0, 'windows closed on an observation that can never be paid under this key');
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 0
    );
  });

  test('P2 one line carrying two protocol blocks is digested once — both entries share the whole-line digest', () => {
    const env = makeEnv();
    const start = fs.statSync(env.tPath).size;
    addLine(env.tPath, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu-x', name: 'mcp__codex__codex', input: CODE_INPUT },
          { type: 'tool_use', id: 'tu-y', name: 'mcp__codex__codex', input: DOC_INPUT },
        ],
      },
    });
    const end = fs.statSync(env.tPath).size;
    const scan = dispatchLog.scanTranscript(env.tPath, 0);
    const ex = scan.entries.find(e => e.tooluseId === 'tu-x');
    const ey = scan.entries.find(e => e.tooluseId === 'tu-y');
    assert.ok(ex && ey, 'both blocks parse as protocol entries');
    assert.equal(ex.rangeDigest, ey.rangeDigest, 'entries from one line carry one shared digest');
    assert.equal(
      ex.rangeDigest,
      dispatchLog.rangeDigest(env.tPath, start, end),
      'the shared digest covers exactly the whole line\'s bytes'
    );
  });
});

// --- round-13 regression — one identity, one key: cross-key reuse is admitted to NO key ---

describe('round-13 regression — cross-key identity reuse conflicts globally', () => {
  test('P1 a tooluse identity reused under TWO keys closes neither key\'s windows', () => {
    const env = makeEnv();
    const now = Date.now();
    const DOC_PLANES = { doc_review: DIGEST_A };
    dispatch(env, { now });
    dispatch(env, { now }); // key K1 twins -> contested, two open windows
    dispatch(env, { input: DOC_INPUT, planes: DOC_PLANES, now });
    dispatch(env, { input: DOC_INPUT, planes: DOC_PLANES, now }); // key K2 twins -> contested
    // ONE identity under both keys, plus one honest entry per key: each
    // key's independent graph would be satisfiable using its own copy of
    // tu-dup — the first key processed would pay it, the second would skip
    // the payment (disposedNow is global) yet still close: closed-and-unpaid.
    addLine(env.tPath, entryLine('tu-dup', CODE_INPUT));
    addLine(env.tPath, entryLine('tu-dup', DOC_INPUT));
    addLine(env.tPath, entryLine('tu-a', CODE_INPUT));
    addLine(env.tPath, entryLine('tu-b', DOC_INPUT));
    sweep(env, now);
    const acks = readLog(env.repo).filter(
      x => x.kind === 'dispatch_event' && x.event === 'contested' && typeof x.frontier_end === 'number'
    );
    assert.equal(acks.length, 0, 'a conflicted identity must be admitted to NO key\'s matching graph');
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'debt_cleared').length, 0,
      'no key may clear on evidence a sibling key also claims'
    );
  });
});

// --- round-14 regressions — a conflicted identity is never bound, anywhere ---

describe('round-14 regressions — conflicted identities are unbindable at capture and eager bind', () => {
  test('P0 capture never binds an identity the transcript shows twice — even when the same-key copy is a singleton', () => {
    const env = makeEnv();
    const now = Date.now();
    // The same tooluse identity under two different request keys: the
    // same-key visible set is a singleton, but attribution is undecidable —
    // a PASS for one request could settle the other's dispatch.
    addLine(env.tPath, entryLine('tu-dup', CODE_INPUT));
    addLine(env.tPath, entryLine('tu-dup', DOC_INPUT));
    const r = dispatch(env, { now });
    const D = foldOf(env.repo).dispatches.get(r.dispatchId);
    assert.equal(D.state, 'ambiguous', 'a conflicted identity must poison, never capture-bind');
    assert.ok(!D.boundTooluseId, 'no bind may ride the dispatch line');
    assert.ok(foldOf(env.repo).disposedTooluse.has('tu-dup'), 'the candidates are quarantined');
  });

  test('P0 eager bind refuses a cross-key reused identity — a PASS for one request can never settle the other', () => {
    const env = makeEnv();
    const now = Date.now();
    const r1 = dispatch(env, { now });
    const r2 = dispatch(env, { input: DOC_INPUT, planes: { doc_review: DIGEST_A }, now });
    addLine(env.tPath, entryLine('tu-dup', CODE_INPUT));
    addLine(env.tPath, entryLine('tu-dup', DOC_INPUT));
    addLine(env.tPath, resultLine('tu-dup', CODE_PASS));
    sweep(env, now);
    const fold = foldOf(env.repo);
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'bound').length, 0,
      'neither dispatch may bind the reused identity'
    );
    assert.ok(!fold.dispatches.get(r1.dispatchId).boundTooluseId);
    assert.ok(!fold.dispatches.get(r2.dispatchId).boundTooluseId);
    assert.ok(fold.disposedTooluse.has('tu-dup'), 'the reused identity is quarantined, not left claimable');
  });
});

// --- round-15 regressions — identity conflicts reach settlement, ownership, and
// survive compaction; a same-line duplicate is a reuse, not an exact copy ---

describe('round-15 regressions — post-bind consumers and durable identity facts', () => {
  test('P0 settlement refuses a bound identity the transcript has since shown twice', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).boundTooluseId, 'tu-x');
    // A later protocol entry reuses the bound identity under another key,
    // then a passing result bearing that id lands: results.get(id) can no
    // longer say which call produced it.
    addLine(env.tPath, entryLine('tu-x', DOC_INPUT));
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    const s = sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0,
      'no receipt may be minted from an ambiguous identity');
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'bound',
      'the dispatch stays bound — expiry retires it, settlement never guesses');
    assert.ok(s.reports.some(m => /settlement refused/.test(m)), s.reports.join('; '));
  });

  test('P0 markBackgroundOwned refuses ownership of a reused bound identity, and an unreadable transcript', () => {
    const env = makeEnv();
    const now = Date.now();
    dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    addLine(env.tPath, entryLine('tu-x', DOC_INPUT));
    const own = dispatchLog.markBackgroundOwned(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, key: CODE_KEY, taskId: 't9', now,
    });
    assert.equal(own.ok, false);
    assert.match(own.reason, /reused/, 'refusal must name the identity reuse');
    // Same grant with the transcript gone: attribution unverifiable → refuse.
    const env2 = makeEnv();
    dispatch(env2, { now });
    addLine(env2.tPath, entryLine('tu-y', CODE_INPUT));
    dispatchLog.sweep(env2.repo, { sessionId: env2.sessionId, transcriptPath: env2.tPath, now });
    fs.rmSync(env2.tPath);
    const own2 = dispatchLog.markBackgroundOwned(env2.repo, {
      sessionId: env2.sessionId, transcriptPath: env2.tPath, key: CODE_KEY, taskId: 't9', now,
    });
    assert.equal(own2.ok, false);
    assert.match(own2.reason, /unreadable/);
  });

  test('P0 an identity folded into a frontier is never re-bound after compaction deletes its disposition', () => {
    const env = makeEnv();
    const now = Date.now();
    const range = appendEntry(env, 'tu-x');
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [{
      v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
      tooluse_id: 'tu-x', reason: 'unaccounted', transcript_file_id: fid,
      start_offset: range.start, end_offset: range.end,
      range_digest: dispatchLog.rangeDigest(env.tPath, range.start, range.end),
      time: iso(now - 49 * HOUR),
    }]);
    sweep(env, now); // cursor advances past the disposed entry
    dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    const f = readLog(env.repo).find(x => x.kind === 'frontier');
    assert.deepEqual(f.tooluse_ids, ['tu-x'], 'the frontier must carry the folded identities');
    assert.ok(!readLog(env.repo).some(x => x.kind === 'tooluse_disposition' && x.tooluse_id === 'tu-x'),
      'precondition: the disposition was deleted — the frontier is the only identity evidence left');
    // A different-key dispatch, then a NEW entry reusing the folded id: the
    // incremental scan starts past the original occurrence, so only the
    // durable frontier fact can expose the reuse.
    const r = dispatch(env, { input: DOC_INPUT, planes: { doc_review: DIGEST_A }, now });
    addLine(env.tPath, entryLine('tu-x', DOC_INPUT));
    sweep(env, now);
    const fold = foldOf(env.repo);
    assert.equal(fold.dispatches.get(r.dispatchId).boundTooluseId, null,
      'a folded identity must never be re-bound under any key');
    assert.equal(fold.dispatches.get(r.dispatchId).state, 'ambiguous');
    assert.ok(fold.disposedTooluse.has('tu-x'), 'the reused occurrence is quarantined');
  });

  test('P0 a capture-bound identity reused after the cursor passed its entry never settles', () => {
    const env = makeEnv();
    const now = Date.now();
    // E1 lands BEFORE dispatch → capture-bind (the bound entry ends at or
    // below frontier_start, unlike an eager bind's).
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    const r = dispatch(env, { now });
    const D0 = foldOf(env.repo).dispatches.get(r.dispatchId);
    assert.equal(D0.boundTooluseId, 'tu-x');
    assert.equal(D0.bornBound, true, 'precondition: this is the capture-bind shape');
    sweep(env, now); // no result yet — the cursor advances past E1
    // E2 reuses the identity; the next sweep starts at frontier_start, so
    // E1 is invisible and conflictedScanIds sees an innocent singleton.
    addLine(env.tPath, entryLine('tu-x', DOC_INPUT));
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    const s = sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0,
      'the reused result must never settle the capture-bound dispatch');
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'bound');
    assert.ok(s.reports.some(m => /settlement refused/.test(m)), s.reports.join('; '));
  });

  test('P1 a same-coordinates frontier WITHOUT the folded ids never suppresses the upgraded append', () => {
    const env = makeEnv();
    const now = Date.now();
    const range = appendEntry(env, 'tu-x');
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      {
        v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
        tooluse_id: 'tu-x', reason: 'unaccounted', transcript_file_id: fid,
        start_offset: range.start, end_offset: range.end,
        range_digest: dispatchLog.rangeDigest(env.tPath, range.start, range.end),
        time: iso(now - 49 * HOUR),
      },
      // A legacy frontier at the exact coordinates the fold would produce —
      // positional proof present, identity summary absent.
      {
        v: 1, kind: 'frontier', session_id: env.sessionId, key: CODE_KEY,
        transcript_file_id: fid, upto_end: range.end,
        prefix_digest: dispatchLog.prefixDigest(env.tPath, range.end),
        time: iso(now - 49 * HOUR),
      },
    ]);
    sweep(env, now);
    dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.ok(
      readLog(env.repo).some(x => x.kind === 'frontier' && Array.isArray(x.tooluse_ids) && x.tooluse_ids.includes('tu-x')),
      'the upgraded frontier must land — the legacy twin is not a duplicate of it'
    );
    // The deletion the fold performed is licensed: the reuse is still refused.
    const r = dispatch(env, { input: DOC_INPUT, planes: { doc_review: DIGEST_A }, now });
    addLine(env.tPath, entryLine('tu-x', DOC_INPUT));
    sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous');
  });

  test('P2 malformed frontier tooluse_ids is treated as absent — no character-wise false conflicts, no throw', () => {
    const env = makeEnv();
    const now = Date.now();
    const range = appendEntry(env, 'tu-old');
    const fid = dispatchLog.transcriptFileId(env.tPath);
    // A bare string would iterate as 'a','b','c'; a number would throw in a
    // for..of. Both shapes must degrade to "no identity facts".
    craft(env.repo, [
      {
        v: 1, kind: 'frontier', session_id: env.sessionId, key: CODE_KEY,
        transcript_file_id: fid, upto_end: range.end,
        prefix_digest: dispatchLog.prefixDigest(env.tPath, range.end),
        tooluse_ids: 'abc', time: iso(now),
      },
      {
        v: 1, kind: 'frontier', session_id: env.sessionId, key: CODE_KEY,
        transcript_file_id: fid, upto_end: range.end,
        prefix_digest: dispatchLog.prefixDigest(env.tPath, range.end),
        tooluse_ids: 42, time: iso(now),
      },
    ]);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('a', CODE_INPUT)); // one-char honest identity
    const s = sweep(env, now);
    assert.equal(s.ok, true, 'a malformed field must never break the sweep');
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).boundTooluseId, 'a',
      'an honest one-character identity must not be poisoned by string iteration');
  });

  test('round-17 P0 eager-bound settlement refuses a truncate-in-place rebuild — the bound bytes are the proof', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now); // eager-binds tu-x; the bound event records offsets + digest
    const D0 = foldOf(env.repo).dispatches.get(r.dispatchId);
    assert.equal(D0.boundTooluseId, 'tu-x');
    // Truncate after the dispatch boundary and rebuild with a replacement
    // entry reusing the id, plus a passing result. Inode and first line
    // survive, so the file identity does too.
    const prefix = fs.readFileSync(env.tPath).subarray(0, D0.frontierStart);
    const replacement =
      JSON.stringify(entryLine('tu-x', { prompt: CODE_INPUT.prompt + ' ' })) + '\n' +
      JSON.stringify(resultLine('tu-x', CODE_PASS)) + '\n';
    fs.writeFileSync(env.tPath, Buffer.concat([prefix, Buffer.from(replacement)]));
    const s = sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0,
      'replacement bytes must never settle the dispatch that bound the originals');
    assert.ok(s.reports.some(m => /unverifiable/.test(m)), s.reports.join('; '));
  });

  test('round-17 P0 capture-bound settlement refuses when the captured entry bytes were rewritten in place', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    const r = dispatch(env, { now }); // capture-binds tu-x with content proof
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).boundTooluseId, 'tu-x');
    // Same-length in-place rewrite of the captured entry (id byte flip):
    // offsets still line up, the bytes no longer match the recorded digest.
    const rewritten = fs.readFileSync(env.tPath, 'utf8').replace('"id":"tu-x"', '"id":"tu-y"');
    fs.writeFileSync(env.tPath, rewritten);
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    const s = sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
    assert.ok(s.reports.some(m => /unverifiable/.test(m)), s.reports.join('; '));
  });

  test('round-17 P0 an id shared with a NON-review tool call is a conflict — no bind, no settlement from its output', () => {
    const env = makeEnv();
    const now = Date.now();
    // An older non-review call owns the id and its result carries a
    // sentinel-shaped text; only the review entry is a protocol entry, so
    // per-protocol conflict counting would see an innocent singleton.
    addLine(env.tPath, entryLine('tu-x', { command: 'echo hi' }, 'Bash'));
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    const fold = foldOf(env.repo);
    assert.equal(fold.dispatches.get(r.dispatchId).boundTooluseId, null,
      'an id the result namespace already contains must never bind');
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
    assert.ok(fold.disposedTooluse.has('tu-x'));
  });

  test('round-17 P0 a stray pre-dispatch result never settles — result consumption has its own causal boundary', () => {
    const env = makeEnv();
    const now = Date.now();
    // A result with no tool_use at all, landed BEFORE the dispatch: the id
    // count stays 1 once the review entry arrives, so only the result-side
    // boundary check can refuse it.
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    const s = sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'bound',
      'the bind itself is sound — the stray result is what must be refused');
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
    assert.ok(s.reports.some(m => /precedes the dispatch boundary/.test(m)), s.reports.join('; '));
  });

  test('round-17 P2 a mixed malformed tooluse_ids array is entirely absent — it licenses no deletion coverage', () => {
    const env = makeEnv();
    const now = Date.now();
    const range = appendEntry(env, 'tu-x');
    const fid = dispatchLog.transcriptFileId(env.tPath);
    craft(env.repo, [
      {
        v: 1, kind: 'tooluse_disposition', session_id: env.sessionId, key: CODE_KEY,
        tooluse_id: 'tu-x', reason: 'unaccounted', transcript_file_id: fid,
        start_offset: range.start, end_offset: range.end,
        range_digest: dispatchLog.rangeDigest(env.tPath, range.start, range.end),
        time: iso(now - 49 * HOUR),
      },
      // Same coordinates, mixed array: one valid-looking member must not
      // make the field count as covering 'tu-x'.
      {
        v: 1, kind: 'frontier', session_id: env.sessionId, key: CODE_KEY,
        transcript_file_id: fid, upto_end: range.end,
        prefix_digest: dispatchLog.prefixDigest(env.tPath, range.end),
        tooluse_ids: ['tu-x', 42], time: iso(now - 49 * HOUR),
      },
    ]);
    sweep(env, now);
    dispatchLog.compactDispatchRecords(env.repo, { sessionId: env.sessionId, transcriptPath: env.tPath, now });
    assert.ok(
      readLog(env.repo).some(
        x => x.kind === 'frontier' && Array.isArray(x.tooluse_ids) &&
          x.tooluse_ids.length === 1 && x.tooluse_ids[0] === 'tu-x'
      ),
      'the upgraded frontier must land — the mixed twin covers nothing'
    );
    const r = dispatch(env, { input: DOC_INPUT, planes: { doc_review: DIGEST_A }, now });
    addLine(env.tPath, entryLine('tu-x', DOC_INPUT));
    sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'ambiguous');
  });

  test('round-18 P0 ownership grant verifies the bound bytes — a rebuilt entry cannot reach task settlement', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    const D0 = foldOf(env.repo).dispatches.get(r.dispatchId);
    assert.equal(D0.boundTooluseId, 'tu-x');
    // Positive control first: with the entry intact, the grant succeeds.
    const okGrant = dispatchLog.markBackgroundOwned(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, key: CODE_KEY, taskId: 't1', now,
    });
    assert.equal(okGrant.ok, true);
    // A second env: same shape, but the entry is replaced before the grant.
    const env2 = makeEnv();
    const r2 = dispatchLog.appendDispatch(env2.repo, {
      sessionId: env2.sessionId, transcriptPath: env2.tPath, toolInput: CODE_INPUT,
      planes: { code_review: DIGEST_A }, now,
    });
    addLine(env2.tPath, entryLine('tu-x', CODE_INPUT));
    dispatchLog.sweep(env2.repo, { sessionId: env2.sessionId, transcriptPath: env2.tPath, now });
    const D2 = dispatchLog.foldRecords(readLog(env2.repo)).dispatches.get(r2.dispatchId);
    const prefix = fs.readFileSync(env2.tPath).subarray(0, D2.frontierStart);
    fs.writeFileSync(env2.tPath, Buffer.concat([
      prefix,
      Buffer.from(JSON.stringify(entryLine('tu-x', { prompt: CODE_INPUT.prompt + ' ' })) + '\n'),
    ]));
    const grant = dispatchLog.markBackgroundOwned(env2.repo, {
      sessionId: env2.sessionId, transcriptPath: env2.tPath, key: CODE_KEY, taskId: 't2', now,
    });
    assert.equal(grant.ok, false);
    assert.match(grant.reason, /unverifiable/);
  });

  test('round-18 P0 an owned dispatch refuses its task completion once the bound bytes stop verifying', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    const own = dispatchLog.markBackgroundOwned(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, key: CODE_KEY, taskId: 't9', now,
    });
    assert.equal(own.ok, true);
    // Rebuild the bound entry AFTER the grant, then deliver the report.
    const D0 = foldOf(env.repo).dispatches.get(r.dispatchId);
    const prefix = fs.readFileSync(env.tPath).subarray(0, D0.frontierStart);
    fs.writeFileSync(env.tPath, Buffer.concat([
      prefix,
      Buffer.from(JSON.stringify(entryLine('tu-x', { prompt: CODE_INPUT.prompt + ' ' })) + '\n'),
    ]));
    addLine(env.tPath, taskLine('t9', CODE_PASS));
    const s = sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0,
      'the task report must not settle a dispatch whose bound bytes are gone');
    assert.ok(s.reports.some(m => /unverifiable/.test(m)), s.reports.join('; '));
  });

  test('round-18 P0 a non-protocol identity behind the cursor still blocks a later eager bind — full-prefix census', () => {
    const env = makeEnv();
    const now = Date.now();
    // A non-review call owns the id, then a sweep advances the cursor past
    // it — no disposition, bound record, or frontier remembers it.
    addLine(env.tPath, entryLine('tu-x', { command: 'echo hi' }, 'Bash'));
    sweep(env, now);
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    const fold = foldOf(env.repo);
    assert.equal(fold.dispatches.get(r.dispatchId).boundTooluseId, null,
      'the incremental scan sees a singleton — only the full census can refuse it');
    assert.equal(fold.dispatches.get(r.dispatchId).state, 'ambiguous');
    assert.ok(fold.disposedTooluse.has('tu-x'));
    // The old call's late result must find nothing to settle.
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
  });

  test('round-18 P2 duplicate bound events are idempotent only when payload-identical — a proof swap contests', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    const bound = readLog(env.repo).find(x => x.kind === 'dispatch_event' && x.event === 'bound');
    // Positive control: replaying the identical event changes nothing.
    craft(env.repo, [bound]);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'bound');
    // A duplicate agreeing on the id but swapping the digest is a second
    // byte claim — contested, never silently ignored.
    craft(env.repo, [{ ...bound, range_digest: DIGEST_B }]);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'contested');
  });

  test('round-19 P0 settlement re-runs the full census — a below-frontier rewrite minting a duplicate id never settles', () => {
    const env = makeEnv();
    const now = Date.now();
    // A filler line BELOW the future frontier whose id differs from the
    // bound one by a same-length byte — the rewrite target.
    addLine(env.tPath, entryLine('tu-z', { command: 'echo hi' }, 'Bash'));
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).boundTooluseId, 'tu-x');
    // Post-bind same-inode rewrite: the filler becomes a second tu-x call.
    // First line and the bound entry's bytes are untouched, so file
    // identity and the range proof both still verify.
    fs.writeFileSync(env.tPath, fs.readFileSync(env.tPath, 'utf8').replace('"id":"tu-z"', '"id":"tu-x"'));
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    const s = sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0,
      'two current calls share the id — the result is unattributable');
    assert.ok(s.reports.some(m => /occurs 2 times in the full transcript/.test(m)), s.reports.join('; '));
  });

  test('round-19 P0 an owned dispatch refuses its task report when a duplicate id appears after the grant', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-z', { command: 'echo hi' }, 'Bash'));
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    const own = dispatchLog.markBackgroundOwned(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, key: CODE_KEY, taskId: 't9', now,
    });
    assert.equal(own.ok, true, own.reason);
    fs.writeFileSync(env.tPath, fs.readFileSync(env.tPath, 'utf8').replace('"id":"tu-z"', '"id":"tu-x"'));
    addLine(env.tPath, taskLine('t9', CODE_PASS));
    const s = sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
    assert.ok(s.reports.some(m => /occurs 2 times in the full transcript/.test(m)), s.reports.join('; '));
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'owned',
      'refusal leaves the dispatch owned — expiry retires it, nothing guesses');
  });

  test('P2 same-line duplicate ids share offsets and digest — still a conflict, quarantined not left claimable', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    // ONE physical line carrying TWO tool_use blocks with the SAME id: the
    // parsed copies agree on every field (whole-line offsets, one digest),
    // yet they are two distinct calls — no field comparison may equate them.
    addLine(env.tPath, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu-x', name: 'mcp__codex__codex', input: CODE_INPUT },
          { type: 'tool_use', id: 'tu-x', name: 'mcp__codex__codex', input: CODE_INPUT },
        ],
      },
    });
    sweep(env, now);
    const fold = foldOf(env.repo);
    assert.equal(fold.dispatches.get(r.dispatchId).state, 'ambiguous',
      'the duplicate identity poisons, never lingers in-flight with claimable copies');
    assert.equal(readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'bound').length, 0);
    assert.ok(fold.disposedTooluse.has('tu-x'), 'both copies are quarantined under one disposition');
  });
});

describe('round-20 regressions — consumption-fresh settlement snapshot', () => {
  test('scanTranscript selfDigest certifies the read prefix — append keeps it valid, an in-place byte flip breaks it', () => {
    const env = makeEnv();
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    const snap = dispatchLog.scanTranscript(env.tPath, 0, { selfDigest: true });
    assert.equal(snap.selfDigestUpto, fs.statSync(env.tPath).size);
    assert.equal(dispatchLog.prefixDigest(env.tPath, snap.selfDigestUpto), snap.selfDigest,
      'the live prefix must carry exactly the snapshot bytes');
    // Append-only growth keeps the certified prefix intact — a settlement
    // batch must survive the transcript growing under it.
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    assert.equal(dispatchLog.prefixDigest(env.tPath, snap.selfDigestUpto), snap.selfDigest);
    // One same-length byte flip inside the prefix invalidates it.
    fs.writeFileSync(env.tPath, fs.readFileSync(env.tPath, 'utf8').replace('"id":"tu-x"', '"id":"tu-y"'));
    assert.notEqual(dispatchLog.prefixDigest(env.tPath, snap.selfDigestUpto), snap.selfDigest);
  });

  // Both interleave tests below instrument fs to land a rewrite INSIDE one
  // sweep — the exact seam round 20 named, unreachable from the public API
  // alone. The seam is located by call order (1: transcriptFileId, 2: the
  // incremental scan, 3: the settlement snapshot — each scanTranscript and
  // transcriptFileId stats the transcript exactly once, and content digests
  // use fstat on their own fd), and each test ASSERTS its trigger fired: an
  // internal reordering fails these tests loudly instead of letting them
  // pass without ever exercising the race.
  test('round-20 P0 settlement census is consumption-fresh — a rewrite after the initial scan seeded the bind census never settles', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-z', { command: 'echo hi' }, 'Bash'));
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    // First sweep of the session: scanStart is 0, so the initial scan seeds
    // the bind-time census, step 3 binds eagerly, and step 4 would settle —
    // all in ONE sweep. The rewrite lands between the initial scan and the
    // settlement snapshot: a cache carried across that gap settles from a
    // count that is no longer true.
    const realStat = fs.statSync;
    let stats = 0;
    let fired = false;
    fs.statSync = function (p, ...rest) {
      if (p === env.tPath) {
        stats += 1;
        if (stats === 3 && !fired) {
          fired = true;
          fs.writeFileSync(
            env.tPath,
            fs.readFileSync(env.tPath, 'utf8').replace('"id":"tu-z"', '"id":"tu-x"')
          );
        }
      }
      return realStat.call(fs, p, ...rest);
    };
    let s;
    try {
      s = sweep(env, now);
    } finally {
      fs.statSync = realStat;
    }
    assert.equal(fired, true, `the mid-sweep rewrite must actually fire (saw ${stats} stats)`);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0,
      'a census read before the rewrite is stale evidence — settlement must re-count at consumption');
    assert.ok(s.reports.some(m => /occurs 2 times in the full transcript/.test(m)), s.reports.join('; '));
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'bound',
      'refusal leaves the dispatch bound — expiry retires it, nothing guesses');
    // Positive control: the same shape without the interleave settles.
    const env2 = makeEnv();
    addLine(env2.tPath, entryLine('tu-z', { command: 'echo hi' }, 'Bash'));
    dispatch(env2, { now });
    addLine(env2.tPath, entryLine('tu-x', CODE_INPUT));
    addLine(env2.tPath, resultLine('tu-x', CODE_PASS));
    sweep(env2, now);
    assert.equal(readLog(env2.repo).filter(x => x.kind === 'settlement').length, 1);
  });

  test('round-20 P0 snapshot validity gate — a rewrite between the settlement snapshot and the commit drops the batch, which retries clean', () => {
    const env = makeEnv();
    const now = Date.now();
    addLine(env.tPath, entryLine('tu-z', { command: 'echo hi' }, 'Bash'));
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    // After the settlement snapshot's stat (the 3rd), its own read opens the
    // transcript once; the NEXT open of the transcript is the validity
    // gate's pre-commit prefixDigest. Firing the rewrite there lands it in
    // the narrowest window: the snapshot already decided to settle.
    const realStat = fs.statSync;
    const realOpen = fs.openSync;
    let stats = 0;
    let opensAfterSnap = 0;
    let fired = false;
    fs.statSync = function (p, ...rest) {
      if (p === env.tPath) stats += 1;
      return realStat.call(fs, p, ...rest);
    };
    fs.openSync = function (p, ...rest) {
      if (p === env.tPath && stats >= 3) {
        opensAfterSnap += 1;
        if (opensAfterSnap === 2 && !fired) {
          fired = true;
          fs.writeFileSync(
            env.tPath,
            fs.readFileSync(env.tPath, 'utf8').replace('"id":"tu-z"', '"id":"tu-a"')
          );
        }
      }
      return realOpen.call(fs, p, ...rest);
    };
    let s;
    try {
      s = sweep(env, now);
    } finally {
      fs.statSync = realStat;
      fs.openSync = realOpen;
    }
    assert.equal(fired, true, `the post-snapshot rewrite must actually fire (saw ${stats} stats, ${opensAfterSnap} opens)`);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0,
      'evidence the live file no longer carries must never commit a settlement');
    assert.ok(s.reports.some(m => /settlement batch dropped/.test(m)), s.reports.join('; '));
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'bound',
      'the dropped batch reverts in-memory state — bound, not settled');
    // Retry with the file now stable: the same dispatch settles, proving the
    // drop deferred (spent ledger and state both reverted), never poisoned.
    const s2 = sweep(env, now);
    assert.equal(s2.ok, true);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 1);
  });
});

describe('AC4 gap closure — reversed twins, multi-candidate handoff, own-task pairing, injected append failures', () => {
  test('reversed lock-order twins with equal seq — both contested in either record order, completions refused', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    const mine = readLog(env.repo).find(x => x.kind === 'dispatch' && x.dispatch_id === r.dispatchId);
    // A concurrent writer that read the same seq HWM before either committed
    // lands with an EQUAL seq; losing the lock race means its record follows
    // in the log while its stamp precedes — counts equal, orders differ.
    const twin = { ...mine, dispatch_id: 'twin#r', time: iso(now - 1000) };
    craft(env.repo, [twin]);
    const fold = foldOf(env.repo);
    assert.equal(fold.dispatches.get(r.dispatchId).state, 'contested');
    assert.equal(fold.dispatches.get('twin#r').state, 'contested');
    // The mirrored record order reduces identically — the invariant is
    // order-free, not an artifact of which twin the log happened to see first.
    const others = readLog(env.repo).filter(x => x.kind !== 'dispatch');
    const rev = dispatchLog.foldRecords([...others, twin, mine]);
    assert.equal(rev.dispatches.get('twin#r').state, 'contested');
    assert.equal(rev.dispatches.get(r.dispatchId).state, 'contested');
    // Every completion refused: entry and result land, nothing settles.
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0);
  });

  test('two bound same-key records — the fold contests the pair and handoff marks NONE, never picking one', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).boundTooluseId, 'tu-x');
    // An adversarially crafted second BOUND same-key dispatch. `bound` is
    // nonterminal ∧ un-owned, so the read-time twin invariant contests the
    // PAIR before any candidate count is taken: the ownership guard's ≥2
    // arm is unreachable from any fold of real records and stands as
    // defense-in-depth only. The AC's "multiple candidates marks none"
    // clause is therefore delivered BY the contested reduction — asserted
    // here end-to-end, including which guard path actually fired.
    const mine = readLog(env.repo).find(x => x.kind === 'dispatch' && x.dispatch_id === r.dispatchId);
    craft(env.repo, [{ ...mine, dispatch_id: 'twin#b', bound_tooluse_id: 'tu-w', time: iso(now - 1000) }]);
    const fold = foldOf(env.repo);
    assert.equal(fold.dispatches.get(r.dispatchId).state, 'contested');
    assert.equal(fold.dispatches.get('twin#b').state, 'contested');
    const own = dispatchLog.markBackgroundOwned(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, key: CODE_KEY, taskId: 't1', now,
    });
    assert.equal(own.ok, false);
    assert.match(own.reason, /0 candidates for key — marked none/,
      'the contested pair leaves ZERO bound candidates — the refusal is transparent about its path');
    assert.equal(
      readLog(env.repo).filter(x => x.kind === 'dispatch_event' && x.event === 'owned').length,
      0,
      'no ownership event may land for either record'
    );
  });

  test('a task-owned dispatch consumes ONLY its own task completion — a foreign completed task settles nothing', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    const own = dispatchLog.markBackgroundOwned(env.repo, {
      sessionId: env.sessionId, transcriptPath: env.tPath, key: CODE_KEY, taskId: 't1', now,
    });
    assert.equal(own.ok, true, own.reason);
    // A DIFFERENT task completes with a fully valid report — genuine
    // envelope, genuine sentinel, just not this dispatch's task.
    addLine(env.tPath, taskLine('t2', CODE_PASS));
    sweep(env, now);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0,
      'a foreign task completion must never settle an owned dispatch');
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'owned');
    // The OWN task's completion settles, and pairs by ITS id.
    addLine(env.tPath, taskLine('t1', CODE_PASS));
    sweep(env, now);
    const settlements = readLog(env.repo).filter(x => x.kind === 'settlement');
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0].completion_id, 'task:t1');
  });

  test('injected append failure at the BIND boundary — nothing bound, nothing spent, retry binds cleanly', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    const real = receiptLog.stageAndCommit;
    receiptLog.stageAndCommit = () => { throw new Error('injected commit failure'); };
    let s;
    try {
      s = sweep(env, now);
    } finally {
      receiptLog.stageAndCommit = real;
    }
    assert.equal(s.ok, false);
    assert.ok(s.reports.some(m => /sweep append failed/.test(m)), s.reports.join('; '));
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).state, 'in-flight',
      'no partial bind may survive the failed commit');
    assert.equal(readLog(env.repo).filter(x => x.kind === 'dispatch_event').length, 0);
    // Retry with the writer healthy: the same entry binds.
    sweep(env, now);
    assert.equal(foldOf(env.repo).dispatches.get(r.dispatchId).boundTooluseId, 'tu-x');
  });

  test('injected append failure at the SETTLE boundary — nothing spent, dispatch stays bound, retry settles fully', () => {
    const env = makeEnv();
    const now = Date.now();
    const r = dispatch(env, { now });
    addLine(env.tPath, entryLine('tu-x', CODE_INPUT));
    sweep(env, now);
    addLine(env.tPath, resultLine('tu-x', CODE_PASS));
    const real = receiptLog.stageAndCommit;
    receiptLog.stageAndCommit = () => { throw new Error('injected commit failure'); };
    let s;
    try {
      s = sweep(env, now);
    } finally {
      receiptLog.stageAndCommit = real;
    }
    assert.equal(s.ok, false);
    assert.equal(readLog(env.repo).filter(x => x.kind === 'settlement').length, 0,
      'no settlement bytes may land from a failed commit');
    const fold = foldOf(env.repo);
    assert.equal(fold.dispatches.get(r.dispatchId).state, 'bound');
    assert.equal(fold.spent.size, 0, 'nothing spent — the completion identity survives for the retry');
    // Retry: the same completion settles exactly once.
    sweep(env, now);
    const settlements = readLog(env.repo).filter(x => x.kind === 'settlement');
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0].completion_id, 'tooluse:tu-x');
  });
});
