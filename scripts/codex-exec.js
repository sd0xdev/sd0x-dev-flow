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

function die(code, tag, fields) { process.stderr.write(`[${tag}] ${fields}\n`); process.exit(code); }
const usage = (c, extra = '') => die(2, 'CODEX_EXEC_USAGE', `code=${c}${extra}`);
const config = (c, extra = '') => die(2, 'CODEX_EXEC_CONFIG', `code=${c}${extra}`);
const fail = (reason, tail = '') => die(1, 'CODEX_EXEC_ERROR', `reason=${reason}${tail ? '\n' + tail : ''}`);
const emit = (obj) => process.stdout.write(JSON.stringify({ protocol: PROTOCOL, ...obj }) + '\n');

function parse(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out.positional.push(argv[i]);
  }
  return out;
}
const tmpRoot = () => fs.realpathSync(os.tmpdir());
function isAllocPath(dir) {                        // realpath first: `..` and symlinks resolve away
  let real;
  try { real = fs.realpathSync(dir); } catch { return false; }
  return path.dirname(real) === tmpRoot() && path.basename(real).startsWith(PREFIX);
}
function alloc() {
  let dir;
  try { dir = fs.mkdtempSync(path.join(tmpRoot(), PREFIX)); } catch (e) { fail('fs', e.message); }
  // mkdtemp's 0700 is umask-masked (measured: `umask 277` -> 0500, caller gets EACCES); chmod is not.
  // Both are guarded and remove the dir on failure — no record was emitted, so nothing can `cleanup`.
  try {
    fs.chmodSync(dir, 0o700);
    if ((fs.statSync(dir).mode & 0o777) !== 0o700) throw new Error('alloc dir is not 0700');
  } catch (e) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } fail('fs', e.message); }
  emit({ dir, promptFile: path.join(dir, 'prompt.md'), reportFile: path.join(dir, 'report.md') });
}
function cleanup(dir) {
  if (!dir || !isAllocPath(dir)) usage('invalid_dir');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { fail('fs', e.message); }
}
function gitToplevel() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
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
  // Both files are bound to ONE alloc-shaped directory: the adapter never chmods or writes elsewhere.
  const prompt = o['prompt-file'];
  const dir = prompt ? path.dirname(prompt) : '';
  let st = null;
  try { st = fs.lstatSync(prompt); } catch { st = null; }
  if (!prompt || !path.isAbsolute(prompt) || path.basename(prompt) !== 'prompt.md' || !isAllocPath(dir)
    || !st || !st.isFile() || st.size === 0) usage('invalid_prompt_file');
  try { fs.accessSync(prompt, fs.constants.R_OK); fs.chmodSync(prompt, 0o600); } catch { usage('invalid_prompt_file'); }
  // The report is CREATED here, before the child exists. Why exclusively, why fchmod rather than a
  // create mode, and what each layer does and does not guarantee: codex-transport.md § Files.
  const report = o['report-file'];
  if (!report || !path.isAbsolute(report) || path.basename(report) !== 'report.md' || path.dirname(report) !== dir) {
    usage('invalid_report_file');
  }

  try {
    const fd = fs.openSync(report, 'wx', 0o600);
    fs.fchmodSync(fd, 0o600);
    fs.closeSync(fd);
  } catch { usage('invalid_report_file'); }
  const top = gitToplevel();
  if (!top) usage('no_git_toplevel');
  let thread = null;
  if (cmd === 'resume') {
    thread = o['thread-id'];
    if (!thread || !UUID.test(thread)) usage('invalid_thread_id');
  }
  return { cls, profile, prompt, report, top, thread };
}

function run(cmd, o) {
  const p = preflight(cmd, o);
  const args = ['exec', ...(p.profile ? ['-p', p.profile] : []), '-s', CLASSES[p.cls], '-c', 'approval_policy="never"',
    '-C', p.top, '--color', 'never', ...(cmd === 'resume' ? ['resume', '--json', '-o', p.report, p.thread, '-'] : ['--json', '-o', p.report, '-'])];
  const child = spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  // No securing finalizer: preflight created the report 0600 before the child existed, so its
  // confidentiality does not depend on anything happening after spawn — including on a path that
  // exits while the child is still alive.
  child.on('error', (e) => fail('error', e.message));
  let out = '', errTail = [], written = false;
  // `finish` proves the prompt was WRITTEN whole — not that the child read it; nothing at this layer
  // can prove consumption (codex-transport.md § Completion states that residual). Exit 0 requires it.
  child.stdin.on('finish', () => { written = true; }).on('error', (e) => { if (e.code !== 'EPIPE') fail('error', e.message); });
  fs.createReadStream(p.prompt).on('error', (e) => fail('error', e.message)).pipe(child.stdin);
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { errTail = errTail.concat(String(d).split('\n')).slice(-STDERR_TAIL); });
  child.on('close', (code) => {
    if (code !== 0) fail('error', errTail.join('\n'));
    if (!written) fail('error', 'prompt not fully written — the child closed stdin mid-write');
    let threadId = null;
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { fail('error', 'malformed JSONL'); }
      if (ev && ev.type === 'thread.started' && UUID.test(ev.thread_id || '')) threadId = ev.thread_id;
    }
    if (cmd === 'resume') {
      if (threadId && threadId !== p.thread) fail('error', 'thread id mismatch');
      threadId = p.thread;
    }
    if (!threadId) fail('error', 'no thread.started');
    let st;
    try { st = fs.lstatSync(p.report); } catch { st = null; }
    if (!st || !st.isFile() || st.size === 0) fail('error', 'empty, missing or non-regular report');
    // Success requires the mode we created it with. This does not defend against a hostile child
    // — nothing at this privilege level can (§ Files states the boundary) — it refuses to CALL a
    // widened report a success, which is the part the gate depends on.
    if ((st.mode & 0o777) !== 0o600) fail('error', 'report is not 0600');   // never succeed unsecured
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
