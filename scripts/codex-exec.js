#!/usr/bin/env node
'use strict';
// Transport-only adapter for `codex exec`. Contract: docs/features/codex-exec-transport/2-tech-spec.md § 3.2.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROTOCOL = 1;
const PREFIX = 'codex-exec-';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CLASSES = { review: 'read-only', implement: 'workspace-write' };
const STDERR_TAIL = 20;
// Progress cadence. CODEX_EXEC_TICK_MS is a TEST SEAM (fixture runs finish in milliseconds), not a
// configuration knob: INV-006 governs what a dispatch does; this changes only how often it is
// described. The stall advisory fires after STALL_TICKS silent ticks and kills nothing — the
// adapter still owns no timeout. Contract: codex-transport.md § Progress.
const TICK_MS = Number(process.env.CODEX_EXEC_TICK_MS) || 60000;
const STALL_TICKS = 2;

function die(code, tag, fields) { process.stderr.write(`[${tag}] ${fields}\n`); process.exit(code); }
const usage = (c, extra = '') => die(2, 'CODEX_EXEC_USAGE', `code=${c}${extra}`);
const config = (c, extra = '') => die(2, 'CODEX_EXEC_CONFIG', `code=${c}${extra}`);
const fail = (reason, tail = '') => die(1, 'CODEX_EXEC_ERROR', `reason=${reason}${tail ? '\n' + tail : ''}`);
const emit = (obj) => process.stdout.write(JSON.stringify({ protocol: PROTOCOL, ...obj }) + '\n');
const progress = (s) => process.stderr.write(`[CODEX_EXEC_PROGRESS] ${s}\n`);
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

function parse(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out.positional.push(argv[i]);
  }
  return out;
}
const tmpRoot = () => fs.realpathSync(os.tmpdir());
// Stale sweep, run by `alloc`: a dispatch whose caller never ran `cleanup` (a lost notification, a killed
// session) otherwise sits under the temp root forever — 2180 were measured on 2026-09-05. A live dispatch
// renames progress.json into its dir on every event and tick, so its dir mtime is never a day old. Only
// this user's own 0700 `codex-exec-*` directories (lstat: never a symlink) are removed, best-effort — and
// never by a name after the identity check: rename to a random quarantine name, re-lstat, compare {dev, ino},
// then delete BOUND TO THAT INODE (docs/features/workflow-orchestration/4-implementation.md §1.1 — a
// substitute swapped under the checked name is renamed back, not erased; relocation is recoverable,
// deletion is not). Node has no unlinkat: chdir pins the directory as the kernel's cwd reference, so the
// relative entry names resolve from the inode and a rename of the quarantine name cannot redirect them; the
// closing rmdir is non-recursive, so a substitute with contents is refused and stays quarantined as evidence.
// The mtime is a heartbeat, and a heartbeat can stop while its owner lives: a machine asleep for a day,
// a snapshot that failed. So the sweep also asks for POSITIVE liveness — the owner pid the adapter wrote
// into progress.json at preflight (a guaranteed write, not the best-effort heartbeat) — and never reaps a
// directory whose owner still exists. A reused pid keeps a dead directory a little longer; never the reverse.
const STALE_MS = 24 * 60 * 60 * 1000;
// Read as a fixed PREFIX, never parsed whole: JSON.stringify keeps insertion order, so every snapshot begins
// `{"protocol":1,"status":"…","pid":N`, and a snapshot can be large (child command text and usage payload are
// unbounded) — a whole-file read under a size cap called a live owner dead exactly when its snapshot grew
// (review P1). The byte-0 anchor is what keeps a `pid` nested deeper in the document from counting as the owner.
const OWNER = /^\{"protocol":1,"status":"(?:starting|running|done|failed)","pid":([1-9]\d{0,9})[,}]/;   // canonical: no leading zero
// Returns false only on PROOF of no owner — no record (ENOENT/ENOTDIR/ELOOP), a non-file, a non-owner prefix, or
// ESRCH. Every other probe error (EIO, EMFILE, an unexpected kill error) is "unknown" and reads as true: an
// error is not evidence of death, and keeping a dead directory a day longer costs nothing (review P1).
function ownerAlive(dir) {
  let fd = null;
  try {   // open non-blocking + nofollow, then judge the DESCRIPTOR: a FIFO swapped in after an lstat would park a blocking open forever (review P1)
    try { fd = fs.openSync(path.join(dir, 'progress.json'), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW); } catch (e) { return !['ENOENT', 'ENOTDIR', 'ELOOP'].includes(e.code); }
    if (!fs.fstatSync(fd).isFile()) return false;
    const buf = Buffer.alloc(96); const n = fs.readSync(fd, buf, 0, 96, 0);
    const m = OWNER.exec(buf.toString('utf8', 0, n)), pid = m ? Number(m[1]) : 0; if (pid <= 0 || pid > 0x7fffffff) return false;   // kill(0, 0) "succeeds" on our own group; kill() rejects > INT32
    try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
  } catch { return true; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* best effort */ } }
}
function reapPinned(q, expect) {
  let cwd = null;   // obtained inside the boundary: a removed inherited cwd makes process.cwd() throw, and that is a sweep failure, never alloc's
  try {
    cwd = process.cwd(); process.chdir(q); const here = fs.statSync('.');
    if (here.dev === expect.dev && here.ino === expect.ino) {
      // Each entry the same way as the directory (scripts/skills/necessity-audit/cleanup.js unlinkVerified):
      // rename to a random name, re-lstat, unlink only the inode that was checked; a mismatch stays quarantined.
      for (const n of fs.readdirSync('.')) {
        try {
          const st = fs.lstatSync(n); if (st.isDirectory()) continue;
          const qn = `.reap-${Math.random().toString(36).slice(2)}`; fs.renameSync(n, qn);
          const re = fs.lstatSync(qn); if (re.dev === st.dev && re.ino === st.ino) fs.unlinkSync(qn);
        } catch { /* best effort */ }
      }
    }
  } catch { /* best effort */ } finally { if (cwd !== null) try { process.chdir(cwd); } catch { /* alloc emits an absolute path and exits */ } }
  try { fs.rmdirSync(q); } catch { /* non-empty (a substitute, a nested dir) or gone: left quarantined */ }
}
function sweepStale(root) {
  let uid, names; try { uid = process.getuid(); names = fs.readdirSync(root); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    let st, re; const d = path.join(root, name), q = path.join(root, `.reap-${Math.random().toString(36).slice(2)}`);
    try { st = fs.lstatSync(d); } catch { continue; }
    if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o777) !== 0o700 || Date.now() - st.mtimeMs < STALE_MS || ownerAlive(d)) continue;
    try { fs.renameSync(d, q); re = fs.lstatSync(q); } catch { continue; }
    // Re-decide on the QUARANTINED inode, not on the check made under the old name: a delayed `start` can refresh
    // the same inode and write its owner record between the two, and that dispatch must get its directory back.
    if (re.dev !== st.dev || re.ino !== st.ino || re.uid !== uid || (re.mode & 0o777) !== 0o700 || Date.now() - re.mtimeMs < STALE_MS || ownerAlive(q)) {
      try { fs.renameSync(q, d); } catch { /* best effort */ } continue;
    }
    reapPinned(q, st);
  }
}
function isAllocPath(dir) {                        // realpath first: `..` and symlinks resolve away
  let real;
  try { real = fs.realpathSync(dir); } catch { return false; }
  return path.dirname(real) === tmpRoot() && path.basename(real).startsWith(PREFIX);
}
const scratchPaths = (dir) => ({ promptFile: path.join(dir, 'prompt.md'), reportFile: path.join(dir, 'report.md'),
  progressFile: path.join(dir, 'progress.json'), eventsFile: path.join(dir, 'events.jsonl') });
function alloc() {
  let dir;
  try { sweepStale(tmpRoot()); dir = fs.mkdtempSync(path.join(tmpRoot(), PREFIX)); } catch (e) { fail('fs', e.message); }
  // mkdtemp's 0700 is umask-masked (measured: `umask 277` -> 0500, caller gets EACCES); chmod is not.
  // Both are guarded and remove the dir on failure — no record was emitted, so nothing can `cleanup`.
  try {
    fs.chmodSync(dir, 0o700);
    if ((fs.statSync(dir).mode & 0o777) !== 0o700) throw new Error('alloc dir is not 0700');
  } catch (e) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } fail('fs', e.message); }
  emit({ dir, ...scratchPaths(dir) });
}
function cleanup(dir) {
  if (!dir || !isAllocPath(dir)) usage('invalid_dir');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { fail('fs', e.message); }
}
function gitToplevel() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
// Exclusive creation + fchmod: refuses a squatter (a dangling symlink included) and is not umask-masked.
function createPrivate(file) {   // on a failed fchmod the file we just created and its descriptor go too: snapshot() retries this per event
  let fd = null;
  try { fd = fs.openSync(file, 'wx', 0o600); fs.fchmodSync(fd, 0o600); return fd; }
  catch { if (fd !== null) { try { fs.closeSync(fd); } catch { /* best effort */ } try { fs.unlinkSync(file); } catch { /* best effort */ } } return null; }
}

function preflight(cmd, o) {
  const cls = o.class;
  if (!Object.hasOwn(CLASSES, cls || '')) usage('invalid_class');
  let profile = null;
  if (o.profile !== undefined) {
    if (!PROFILE.test(o.profile)) usage('invalid_profile_name');
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const file = path.join(home, `${o.profile}.config.toml`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) config('profile_missing', ` profile=${o.profile}`);
    profile = o.profile;
  }
  // All scratch files are bound to ONE alloc-shaped directory: the adapter never chmods or writes elsewhere.
  const prompt = o['prompt-file'];
  const dir = prompt ? path.dirname(prompt) : '';
  let st = null;
  try { st = fs.lstatSync(prompt); } catch { st = null; }
  if (!prompt || !path.isAbsolute(prompt) || path.basename(prompt) !== 'prompt.md' || !isAllocPath(dir)
    || !st || !st.isFile() || st.size === 0) usage('invalid_prompt_file');
  try { fs.accessSync(prompt, fs.constants.R_OK); fs.chmodSync(prompt, 0o600); } catch { usage('invalid_prompt_file'); }
  // The report, the event log and the progress file are CREATED here, before the child exists. Why
  // exclusively, why fchmod rather than a create mode, and what each layer guarantees: codex-transport.md § Files.
  const report = o['report-file'];
  if (!report || !path.isAbsolute(report) || path.basename(report) !== 'report.md' || path.dirname(report) !== dir) {
    usage('invalid_report_file');
  }
  const reportFd = createPrivate(report);
  if (reportFd === null) usage('invalid_report_file');
  try { fs.closeSync(reportFd); } catch { usage('invalid_report_file'); }   // inside the exit-2 boundary: an uncaught throw here would read as codex_fail
  const { progressFile, eventsFile } = scratchPaths(dir);
  const eventsFd = createPrivate(eventsFile);
  const progressFd = createPrivate(progressFile);
  if (eventsFd === null || progressFd === null) usage('invalid_progress_file');
  // The owner pid, written before the child exists, is what a later alloc's sweep reads to tell a live dispatch from a dead one.
  try { fs.writeSync(progressFd, JSON.stringify({ protocol: PROTOCOL, status: 'starting', pid: process.pid }) + '\n'); fs.closeSync(progressFd); } catch { usage('invalid_progress_file'); }
  const top = gitToplevel();
  if (!top) usage('no_git_toplevel');
  let thread = null;
  if (cmd === 'resume') {
    thread = o['thread-id'];
    if (!thread || !UUID.test(thread)) usage('invalid_thread_id');
  }
  return { cls, profile, prompt, report, top, thread, progressFile, eventsFd };
}

function run(cmd, o) {
  const p = preflight(cmd, o);
  const args = ['exec', ...(p.profile ? ['-p', p.profile] : []), '-s', CLASSES[p.cls], '-c', 'approval_policy="never"',
    '-C', p.top, '--color', 'never', ...(cmd === 'resume' ? ['resume', '--json', '-o', p.report, p.thread, '-'] : ['--json', '-o', p.report, '-'])];
  // Progress state: only what a reader needs to tell "working" from "silent". Every raw event goes to
  // events.jsonl; nothing accumulates in memory. Timestamps are the adapter's own — the stream carries none.
  const t0 = Date.now();
  // A resume's thread is known before any event; an observed different id still overwrites it and trips the mismatch check.
  const st = { threadId: cmd === 'resume' ? p.thread : null, events: 0, tool: null, tools: 0, last: null, usage: null, errors: 0, malformed: false, seq: 0 };
  const snapshot = (status) => {                  // atomic rewrite; best-effort — the verdict never depends on it
    const now = Date.now();
    const doc = { protocol: PROTOCOL, status, pid: process.pid, threadId: st.threadId, elapsed_s: Math.floor((now - t0) / 1000), events: st.events,
      tool: st.tool, tools_completed: st.tools, last_event_s_ago: st.last === null ? null : Math.floor((now - st.last) / 1000),
      usage: st.usage, errors: st.errors, updated: new Date(now).toISOString() };
    // Exclusive create, never 'w' — 'w' FOLLOWS a planted symlink (review P0). A squatter at the predictable
    // name must not cost the snapshot either (review P1): retry on an unpredictable one, so `done`/`failed` lands.
    let fd = null, tmp;
    for (let i = 0; fd === null && i < 4; i++) { tmp = `${p.progressFile}.${++st.seq}${i ? '.' + Math.random().toString(36).slice(2) : ''}.tmp`; fd = createPrivate(tmp); }
    if (fd === null) return doc;
    let ok = false;
    try { fs.writeSync(fd, JSON.stringify(doc) + '\n'); ok = true; } catch { /* fall through to close */ }
    try { fs.closeSync(fd); } catch { ok = false; }
    try { if (ok) fs.renameSync(tmp, p.progressFile); else fs.unlinkSync(tmp); } catch { try { fs.unlinkSync(tmp); } catch { /* best effort */ } }   // a failed rename must not leave its temp behind
    return doc;
  };
  // No dynamic text reaches stderr raw — child command text OR a path under an environment-chosen temp root:
  // either carrying "\n[CODEX_EXEC_ERROR] …" would forge a diagnostic (review P1, twice). Paths are never truncated.
  const esc = (s) => JSON.stringify(String(s)).slice(1, -1);
  const oneLine = (s) => esc(s).slice(0, 80), num = (v) => (Number.isFinite(v) ? v : '?');   // usage is child-sent: show finite numbers only
  const tick = () => {                            // heartbeat ≠ progress: every line says how old the last event is
    const d = snapshot('running');
    const idleMs = Date.now() - (st.last ?? t0);   // ms, not the floored seconds: the seam runs sub-second
    const tokens = d.usage ? `in:${num(d.usage.input_tokens)}/out:${num(d.usage.output_tokens)}` : 'unreported';
    const stall = idleMs >= STALL_TICKS * TICK_MS ? ` — no event for ${Math.floor(idleMs / 1000)}s, check` : '';
    progress(`t=${mmss(d.elapsed_s * 1000)} events=${d.events} tools_completed=${d.tools_completed} tool=${d.tool === null ? 'none' : oneLine(d.tool)}`
      + ` last_event=${d.last_event_s_ago === null ? 'none' : `${d.last_event_s_ago}s ago`} tokens=${tokens}${stall}`);
  };
  const onLine = (line) => {
    if (!line.trim()) return;
    try { fs.writeSync(p.eventsFd, line + '\n'); } catch { /* best effort */ }
    let ev;
    try { ev = JSON.parse(line); } catch { st.malformed = true; return; }
    st.events++; st.last = Date.now();
    const it = ev && ev.item;
    if (ev && ev.type === 'thread.started' && UUID.test(ev.thread_id || '')) {
      st.threadId = ev.thread_id;
      progress(`started thread=${st.threadId} class=${p.cls} profile=${p.profile ?? 'default'}`);
    } else if (ev && ev.type === 'item.started' && it && it.type === 'command_execution') st.tool = it.command ?? 'command';
    else if (ev && ev.type === 'item.completed' && it && it.type === 'command_execution') { st.tool = null; st.tools++; }
    else if (ev && ev.type === 'item.completed' && it && it.type === 'error') st.errors++;   // informational: exit decides
    else if (ev && ev.type === 'turn.completed' && ev.usage && typeof ev.usage === 'object') st.usage = ev.usage;
    snapshot('running');
  };
  const child = spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  // No securing finalizer: preflight created the report 0600 before the child existed, so its
  // confidentiality does not depend on anything after spawn — even a path that exits with the child alive.
  // ONE post-start failure routine (review P1): every exit-1 path records `failed` before its diagnostic.
  let timer = null;
  const abort = (why) => { clearInterval(timer); try { fs.closeSync(p.eventsFd); } catch { /* closed */ } snapshot('failed'); fail('error', why); };
  child.on('error', (e) => abort(e.message));
  snapshot('running');
  timer = setInterval(tick, TICK_MS);
  let buf = '', errTail = [], written = false;
  // `finish` proves the prompt was WRITTEN whole — not that the child read it; nothing at this layer
  // can prove consumption (codex-transport.md § Completion states that residual). Exit 0 requires it.
  child.stdin.on('finish', () => { written = true; }).on('error', (e) => { if (e.code !== 'EPIPE') abort(e.message); });
  fs.createReadStream(p.prompt).on('error', (e) => abort(e.message)).pipe(child.stdin);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  child.stderr.on('data', (d) => { errTail = errTail.concat(String(d).split('\n')).slice(-STDERR_TAIL); });
  child.on('close', (code) => {
    clearInterval(timer);
    onLine(buf); buf = '';
    if (code !== 0) abort(errTail.join('\n'));
    if (!written) abort('prompt not fully written — the child closed stdin mid-write');
    if (st.malformed) abort('malformed JSONL');
    let threadId = st.threadId;
    if (cmd === 'resume') {
      if (threadId && threadId !== p.thread) abort('thread id mismatch');
      threadId = p.thread;
    }
    if (!threadId) abort('no thread.started');
    let rs;
    try { rs = fs.lstatSync(p.report); } catch { rs = null; }
    if (!rs || !rs.isFile() || rs.size === 0) abort('empty, missing or non-regular report');
    // Success requires the mode we created it with. This does not defend against a hostile child
    // — nothing at this privilege level can (§ Files states the boundary) — it refuses to CALL a
    // widened report a success, which is the part the gate depends on.
    if ((rs.mode & 0o777) !== 0o600) abort('report is not 0600');   // never succeed unsecured
    try { fs.closeSync(p.eventsFd); } catch { /* already closed */ }
    snapshot('done');
    progress(`done elapsed=${mmss(Date.now() - t0)} report=${esc(p.report)}`);
    emit({ threadId, reportFile: p.report, requestedProfile: p.profile, class: p.cls });
  });
}

function main() {
  const o = parse(process.argv.slice(2));
  if (String(o.protocol) !== String(PROTOCOL)) config('protocol_mismatch', ` expected=${PROTOCOL} received=${o.protocol ?? 'none'}`);
  const [cmd, arg] = o.positional;
  if (cmd === 'alloc') return alloc();
  if (cmd === 'cleanup') return cleanup(arg);
  if (cmd === 'start' || cmd === 'resume') return run(cmd, o);
  usage('invalid_command');
}

main();
