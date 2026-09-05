#!/usr/bin/env node
'use strict';
// Fake `codex` binary for adapter tests. Behaviour is selected by env:
//   FAKE_CODEX_MODE   ok (default) | no_thread | malformed | empty_report | exit3 | other_id | early_exit | partial_stdin | verbose_stderr | replace_report | widen_report
//   FAKE_CODEX_LOG    file to append the argv JSON line to (proves launch + argv order)
//   FAKE_CODEX_STDIN  file to write the prompt received on stdin
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.FAKE_CODEX_LOG) fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(args) + '\n');
// early_exit: leave BEFORE draining stdin. With a prompt larger than the pipe buffer the adapter's
// write side then gets EPIPE, which is the case that used to crash it with a raw stack and exit 1 —
// the one code that means codex_fail, so an internal stream failure looked like a Codex failure.
if (process.env.FAKE_CODEX_MODE === 'early_exit') process.exit(0);
// partial_stdin: read a token amount, then close stdin and carry on to a fully SUCCESSFUL run —
// valid thread.started, valid 0600 report, exit 0. This is the case that a bare "swallow EPIPE"
// lets through: every success check passes while the review ran against a truncated prompt. The
// adapter must therefore prove the whole prompt was delivered, not merely that the child was happy.
let stdin = '';
if (process.env.FAKE_CODEX_MODE === 'partial_stdin') {
  const buf = Buffer.alloc(64);
  try { fs.readSync(0, buf, 0, 64, null); } catch { /* nothing buffered yet is fine */ }
  stdin = buf.toString('utf8');
  try { fs.closeSync(0); } catch { /* already gone */ }
} else {
  stdin = fs.readFileSync(0, 'utf8');
}
if (process.env.FAKE_CODEX_STDIN) fs.writeFileSync(process.env.FAKE_CODEX_STDIN, stdin);
// FAKE_CODEX_WAIT: block until this sentinel file appears, so a test can observe the tree while
// the child is provably still running.
if (process.env.FAKE_CODEX_WAIT) {
  const gate = process.env.FAKE_CODEX_WAIT;
  fs.writeFileSync(gate + '.ready', 'in-wait');     // readiness evidence: the child IS running now
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(gate) && Date.now() < deadline) { /* spin */ }
}
// FAKE_CODEX_SIDE_FILE: create an unrelated workspace file, the way an implement-class run would.
if (process.env.FAKE_CODEX_SIDE_FILE) fs.writeFileSync(process.env.FAKE_CODEX_SIDE_FILE, 'artifact\n');
const mode = process.env.FAKE_CODEX_MODE || 'ok';
// 'replace_report': unlink the adapter-created report and write a new one, which is how a child
// could defeat pre-creation if it did not inherit a restrictive umask.
const oIdx = args.indexOf('-o');
const report = oIdx >= 0 ? args[oIdx + 1] : null;
const resumeIdx = args.indexOf('resume');
const suppliedId = resumeIdx >= 0 ? args[args.length - 2] : null;
const id = mode === 'other_id' ? '11111111-2222-4333-8444-555555555555' : (suppliedId || 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
const lines = [];
if (mode !== 'no_thread') lines.push(JSON.stringify({ type: 'thread.started', thread_id: id }));
lines.push(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'report body' } }));
if (mode === 'malformed') lines.push('{not json');
process.stdout.write(lines.join('\n') + '\n');
if (report && mode === 'replace_report') { fs.rmSync(report, { force: true }); fs.writeFileSync(report, 'replacement written by the child\n'); }
else if (report && mode === 'widen_report') { fs.writeFileSync(report, '## Document Review\n\n✅ Mergeable\n'); fs.chmodSync(report, 0o644); }
else if (report && mode !== 'empty_report') fs.writeFileSync(report, '## Document Review\n\nreport for: ' + stdin.slice(0, 40) + '\n\n✅ Mergeable\n');
if (report && mode === 'empty_report') fs.writeFileSync(report, '');
// verbose_stderr: emit more lines than STDERR_TAIL (20) keeps, so a test can prove the tail is
// actually bounded rather than merely declared — the fixture's ordinary single line never exceeds
// any bound, which is why AC5's "bounded" clause had no test to fail if the constant were removed.
if (mode === 'verbose_stderr') { for (let i = 1; i <= 30; i++) process.stderr.write(`stderr line ${i}\n`); }
else process.stderr.write('fake codex stderr line\n');
process.exit(mode === 'exit3' || mode === 'replace_report' || mode === 'verbose_stderr' ? 3 : 0);
