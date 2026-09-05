'use strict';
// Pins the canonical transport contract: the sections it must define, the load-bearing sentences
// of its completion state machine, and the fact that adopting it did not weaken
// rules/codex-invocation.md's anti-anchoring clauses.
// Contract: docs/features/codex-exec-transport/2-tech-spec.md § 3.3.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = resolve(__dirname, '../..');
const REF = join(ROOT, 'skills/codex-code-review/references/codex-transport.md');
const ref = readFileSync(REF, 'utf8');
const invocation = readFileSync(join(ROOT, 'rules/codex-invocation.md'), 'utf8');
const autoLoop = readFileSync(join(ROOT, 'rules/auto-loop.md'), 'utf8');
const project = readFileSync(join(ROOT, 'rules/auto-loop-project.md'), 'utf8');

const sectionOf = (text, heading) => {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
};

describe('codex-transport.md defines every section the contract owns', () => {
  const REQUIRED = ['Locator', 'Files', 'Alloc', 'Start', 'Resume', 'Cleanup',
    'Completion state machine', 'Progress', 'Profile', 'Permission'];
  for (const h of REQUIRED) {
    test(`§ ${h} exists and is not empty`, () => {
      const body = sectionOf(ref, h);
      assert.ok(body !== null, `§ ${h} is missing`);
      assert.ok(body.trim().length > 0, `§ ${h} is empty`);
    });
  }
});

describe('§ Progress — observable while running, never a verdict (work item 7, 2026-09-05)', () => {
  const progress = sectionOf(ref, 'Progress');
  test('names the three channels, and keeps stdout out of them', () => {
    assert.match(progress, /events\.jsonl/);
    assert.match(progress, /progress\.json/);
    assert.match(progress, /\[CODEX_EXEC_PROGRESS\]/);
    assert.match(progress, /stdout, which stays\s+exactly one control record/);
  });
  test('heartbeat is not progress, and the advisory kills nothing — the adapter still owns no timeout', () => {
    assert.match(progress, /Heartbeat is not progress/);
    assert.match(progress, /last_event=/);
    assert.match(progress, /owns no\s+timeout and kills nothing/);
  });
  test('a progress line is never a verdict, probe result or note (INV-005)', () => {
    assert.match(progress, /never a\s+verdict,\s+a probe result or a\s+`review-state\.js`\s+note/);
  });
  test('the failure diagnostic is found by tag, not by position', () => {
    assert.match(progress, /identified by\s+its tag, not by being the first byte of stderr/);
  });
  test('background dispatches are observed by push (Monitor), and the poll loop is declined by name', () => {
    assert.match(progress, /push,\s+not poll/);
    assert.match(progress, /Monitor tool/);
    assert.match(progress, /declined/);
  });
  test('the cadence seam is declared a test seam, not a knob — § Profile stays the one knob', () => {
    assert.match(progress, /CODEX_EXEC_TICK_MS/);
    assert.match(progress, /test seam, not a configuration knob/);
    assert.match(progress, /INV-006/);
  });
  test('the § Alloc record names both progress files', () => {
    const alloc = sectionOf(ref, 'Alloc');
    assert.match(alloc, /"progressFile"/);
    assert.match(alloc, /"eventsFile"/);
  });
  test('the observation recipe is executable and writes no file of its own', () => {
    // Two review rounds shaped this. A doc review found the recipe described but not executable —
    // no command, no termination, no Monitor duration. A code review then found the fix's `tee`
    // mirror was a symlink-overwrite path: a predictable `<alloc>/adapter.err` opened by a tool that
    // follows links. The recipe now READS the adapter-owned progress.json and creates nothing.
    const script = (progress.match(/```bash\n([\s\S]*?)```/) || [, ''])[1];
    // The path is a LITERAL the caller pastes from the alloc record: a `$DIR` here would resolve
    // to `/progress.json` in the Monitor's own shell and watch nothing forever (a doc review
    // measured it). So the test does what a caller does — substitutes a real path — and RUNS the
    // recipe, rather than grepping for a variable name.
    assert.doesNotMatch(script, /\$DIR/, 'the recipe must not depend on a shell variable no tool call can see');
    // No apostrophe inside the single-quoted placeholder: the first version had one ("dispatch's")
    // and the documented line was unbalanced bash — this execution is what caught it.
    // The fence sits inside a numbered list, so its lines carry the list indent: anchor on `^\s*`.
    assert.match(script, /^\s*P='<progressFile from the alloc record of this dispatch, pasted literally>'/m);
    assert.doesNotMatch(script, /tee|>\s*"|>>|adapter\.err/, 'the recipe must not create or write any file');
    // The path's parent carries an apostrophe on purpose: the temp root is environment-chosen, and a
    // raw paste inside single quotes hands bash an unbalanced command (a code review measured it).
    // The literal is escaped the way the reference prescribes — `'` becomes `'\''` — and the
    // substitution goes through a callback, so `$&`-style replacement tokens in a path cannot
    // corrupt it either.
    // Structural, not textual: a greedy `sed` over the JSON text read keys nested inside the
    // child-sent `usage` object as top-level state (a code review measured a forged
    // `usage.status:"failed"` stopping the watcher mid-run). The read goes through `node` now, and
    // the fixture below poisons `usage` with every key the recipe consumes: the top level must win.
    assert.doesNotMatch(script, /sed -n 's\/\.\*"status"/, 'no greedy text match on the JSON');
    assert.match(script, /node -e 'const j = JSON\.parse\(/, 'the state is read through node');
    assert.match(script, /j\.protocol !== 1 \|\| !\["running", "done", "failed"\]\.includes\(j\.status\)/, 'and validated as a snapshot before it counts as a read');
    const dir = mkdtempSync(join(tmpdir(), "cx-recipe-o'quote-"));
    try {
      const progressFile = join(dir, 'progress.json');
      const poisoned = { status: 'failed', threadId: 'ffffffff-0000-4000-8000-000000000000', elapsed_s: 999999, last_event_s_ago: 999, input_tokens: 1 };
      writeFileSync(progressFile, JSON.stringify({ protocol: 1, status: 'done', threadId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', elapsed_s: 641, events: 9, tool: null, tools_completed: 2, last_event_s_ago: 3, usage: poisoned, errors: 0, updated: 'x' }) + '\n');
      const shellLiteral = `'${progressFile.replace(/'/g, `'\\''`)}'`;
      const bound = script.replace(/^(\s*)P='<[^']*>'/m, (_, indent) => `${indent}P=${shellLiteral}`);
      assert.notEqual(bound, script, 'the placeholder must have been substituted, or the run below watches nothing');
      assert.match(progress, /an apostrophe inside it is written `'\\''`/, 'the reference states the escaping rule the caller must apply');
      const r = spawnSync('bash', ['-c', bound], { encoding: 'utf8', timeout: 10000 });
      assert.equal(r.status, 0, `the recipe must exit on the terminal status: ${r.stderr}`);
      assert.deepEqual(r.stdout.trim().split('\n'), ['started thread=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 't=10m elapsed, last event 3s ago', 'done after 641s'],
        'started once, the five-minute mark the elapsed time has passed, then the terminal status');
      // The watcher must die on its own when there is nothing to read — after `cleanup`, on a
      // wrong path, or on a preflight failure that left the file empty. Seven orphans were measured
      // on 2026-09-05 with the previous recipe, whose only exit was a terminal status a deleted
      // file can never carry. The poll interval is shortened so three polls take a fraction of a
      // second; the recipe's own `sleep 30` is what a caller runs, and three polls is the 60 s.
      const bind = (p) => script.replace(/^(\s*)P='<[^']*>'/m, (_, indent) => `${indent}P='${p.replace(/'/g, `'\\''`)}'`).replace(/sleep 30/g, 'sleep 0.05');
      const never = join(dir, 'never-created.json'), empty = join(dir, 'empty-preflight.json'), braces = join(dir, 'braces.json'), starting = join(dir, 'starting.json');
      writeFileSync(empty, ''); writeFileSync(braces, '{}\n'); writeFileSync(starting, JSON.stringify({ protocol: 1, status: 'starting', pid: 1 }) + '\n');
      assert.match(bind(never), /sleep 0\.05/, 'the interval was shortened, or the run below takes a minute');
      // `{}` parses, and the first version reset `miss` on any parse: a wrong path that held JSON
      // was polled forever (a code review measured it). A snapshot is protocol 1 plus a run status;
      // the preflight-written `starting` record is not a run either.
      for (const [label, p] of [['a path that never exists', never], ['an empty, preflight-shaped file', empty], ['a stable file holding {}', braces], ['the preflight starting record', starting]]) {
        const r2 = spawnSync('bash', ['-c', bind(p)], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r2.status, 0, `${label}: the recipe must exit on its own — ${r2.stderr}`);
        assert.deepEqual(r2.stdout.trim().split('\n'), ['progress unreadable for 60s — dispatch ended, cleaned up, or wrong path'], `${label}: exactly one line, then exit`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
    // The other terminal status the shell branch accepts, run rather than assumed.
    const dir2 = mkdtempSync(join(tmpdir(), 'cx-recipe-failed-'));
    try {
      const pf = join(dir2, 'progress.json');
      writeFileSync(pf, JSON.stringify({ protocol: 1, status: 'failed', threadId: null, elapsed_s: 7, last_event_s_ago: null }) + '\n');
      const r3 = spawnSync('bash', ['-c', script.replace(/^(\s*)P='<[^']*>'/m, (_, indent) => `${indent}P='${pf}'`)], { encoding: 'utf8', timeout: 10000 });
      assert.equal(r3.status, 0, r3.stderr);
      assert.deepEqual(r3.stdout.trim().split('\n'), ['failed after 7s'], 'a failed run with no thread id: no started line, the terminal line, exit');
    } finally { rmSync(dir2, { recursive: true, force: true }); }
    assert.match(progress, /bound to the file's readability/, 'the reference states why the watcher ends itself');
    assert.match(script, /-ge 3 \]/, 'three polls: the first at once, then two 30 s sleeps — the 60 s the line claims');
    // The two summaries that restate the count must agree with the recipe: a review found both still saying "two".
    const request = readFileSync(join(ROOT, 'docs/features/codex-exec-transport/requests/2026-09-05-observer-lifecycle-and-stale-alloc.md'), 'utf8');
    const spec = readFileSync(join(ROOT, 'docs/features/codex-exec-transport/2-tech-spec.md'), 'utf8');
    assert.match(request, /exits after \*\*three\*\*/, 'the request Fix row says three polls');
    assert.match(spec, /ends itself after three polls/, 'the spec work-item row says three polls');
    assert.match(progress, /no longer an obligation/, 'step 3 no longer depends on a TaskStop the conversation must remember');
    const allocSec = sectionOf(ref, 'Alloc');
    assert.match(allocSec, /reaps its own stale siblings/, '§ Alloc states the sweep');
    assert.match(allocSec, /\*\*24 h\*\*/, '§ Alloc states the age');
    assert.match(allocSec, /never followed/, '§ Alloc states the symlink rule');
    assert.match(progress, /\*\*`persistent: true`\*\*/, 'the Monitor duration is stated — the default five minutes would kill it');
    assert.match(progress, /\*\*TaskStop\*\*/);
    assert.match(progress, /completion notification/);
    assert.match(progress, /redirect nothing/i);
    assert.match(progress, /best-effort/);
    assert.match(progress, /only the one incomplete line/);
  });
  test('the observer tolerates one miss and counts only CONSECUTIVE misses — one valid read resets it', async () => {
    // Pinned as a runtime sequence, not a threshold constant: `-ge 3` → `-ge 2` and a dropped
    // `miss=0` would each pass the absent-file runs above. The recipe's sleep is replaced by a
    // stderr marker plus a blocking read on stdin, so each poll is observable AND the next one
    // starts only when the test says so — no scheduler interval to lose under suite load.
    const { spawn } = require('node:child_process');
    const { once } = require('node:events');
    const script = (sectionOf(ref, 'Progress').match(/```bash\n([\s\S]*?)```/) || [, ''])[1];
    const dir = mkdtempSync(join(tmpdir(), 'cx-recipe-seq-'));
    let child = null, closed = null;   // hoisted so the finally can always end the shell: a failed assertion must not leave it blocked on stdin
    try {
      const progressFile = join(dir, 'lifecycle.json');
      const command = script.replace(/^(\s*)P='<[^']*>'/m, (_, indent) => `${indent}P='${progressFile.replace(/'/g, `'\\''`)}'`).replace(/sleep 30/g, 'echo __POLL__ >&2; read -r _');   // each poll waits for a stdin line: no scheduler timing in the proof
      assert.match(command, /__POLL__/);
      child = spawn('bash', ['-c', command], { stdio: ['pipe', 'pipe', 'pipe'] });
      closed = once(child, 'close');   // registered before anything else so a fast exit is never missed
      const step = () => child.stdin.write('\n');   // release the watcher into its next poll
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
      const polls = () => (err.match(/__POLL__/g) || []).length;
      const until = async (n) => { const deadline = Date.now() + 5000; while (polls() < n) { if (Date.now() > deadline) throw new Error(`timed out waiting for poll ${n}: ${out} ${err}`); await new Promise((r) => setTimeout(r, 10)); } };
      await until(1);                                   // poll 1 done: the file did not exist — one miss; the watcher now waits on stdin
      assert.equal(child.exitCode, null, 'one miss must not end the watcher');
      writeFileSync(progressFile, JSON.stringify({ protocol: 1, status: 'running', threadId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', elapsed_s: 30, last_event_s_ago: 1 }) + '\n');
      step(); await until(2);                           // poll 2: a valid read — the count resets
      assert.equal(child.exitCode, null);
      rmSync(progressFile);
      step(); await until(3);                           // poll 3: miss one after the reset
      assert.equal(child.exitCode, null, 'the first miss after a valid read must not end the watcher — misses are consecutive');
      step(); await until(4);                           // poll 4: miss two — still 30 s short of the 60 s the line claims
      assert.equal(child.exitCode, null, 'two misses are 30 s of silence, not 60: the watcher waits for the third');
      step();
      const [code] = await closed;                      // poll 5: the third consecutive miss ends it
      assert.equal(code, 0);
      assert.deepEqual(out.trim().split('\n'), ['started thread=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'progress unreadable for 60s — dispatch ended, cleaned up, or wrong path']);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) { child.stdin.destroy(); child.kill('SIGKILL'); }
      if (closed) await closed.catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // The Monitor tool delivers to the session that armed it, so the recipe is prescribed only by
  // skills that run in the parent session, and they must grant the tool — the same pair
  // test/skills/watch-ci.test.js pins for watch-ci. A `context: fork` skill must not carry the grant.
  // Frontmatter is read by key with the quoting YAML allows — `"context": fork` is the same key as
  // `context: fork`, and a reviewer showed the bare `^context:` anchor missed it.
  const frontmatterOf = (name) => readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8').split('\n---')[0];
  const toolsOf = (fm) => ((fm.match(/^\s*["']?allowed-tools["']?\s*:\s*(.*)$/m) || [, ''])[1]).split(',').map((s) => s.trim()).filter(Boolean);
  const hasContext = (fm) => /^\s*["']?context["']?\s*:/m.test(fm);
  const MONITOR_SKILLS = ['codex-code-review', 'codex-review', 'codex-review-fast', 'codex-review-branch'];
  for (const name of MONITOR_SKILLS) {
    test(`${name} grants Monitor and declares no context key in any spelling (parent session)`, () => {
      const fm = frontmatterOf(name);
      assert.ok(toolsOf(fm).includes('Monitor'), `${name} allowed-tools must include Monitor (got: ${toolsOf(fm).join(', ')})`);
      assert.equal(hasContext(fm), false, `${name} must run in the parent session or Monitor notifications never reach the conversation`);
    });
  }
  test('no context-forked skill grants Monitor — the notifications could not reach the conversation', () => {
    // The other direction, over the whole tree: adding Monitor to `doc-review` (context: fork) used
    // to pass every check. Negative controls: the two known forked transport owners must be caught.
    const forkedWithMonitor = readdirSync(join(ROOT, 'skills'))
      .filter((d) => existsSync(join(ROOT, 'skills', d, 'SKILL.md')))
      .filter((d) => { const fm = frontmatterOf(d); return hasContext(fm) && toolsOf(fm).includes('Monitor'); });
    assert.deepEqual(forkedWithMonitor, [], `context-forked skills granting Monitor: ${forkedWithMonitor.join(', ')}`);
    for (const forked of ['doc-review', 'test-review']) {
      assert.equal(hasContext(frontmatterOf(forked)), true, `${forked} is the negative control and must still be forked`);
      assert.equal(toolsOf(frontmatterOf(forked)).includes('Monitor'), false);
    }
    assert.equal(hasContext('"context": fork\n'), true, 'the detector must see a quoted key');
  });
  test('§ Permission states the Monitor grant rule and names the fork exclusion', () => {
    const permission = sectionOf(ref, 'Permission');
    assert.match(permission, /`Monitor` is a separate grant/);
    assert.match(permission, /context: fork/);
    for (const name of MONITOR_SKILLS) assert.ok(permission.includes(`\`${name}\``), `§ Permission must name ${name}`);
  });
});

describe('§ Locator — the cascade and the no-overwrite rule', () => {
  const locator = sectionOf(ref, 'Locator');
  test('installed copy first, plugin auto-install only into a missing destination, source last', () => {
    assert.match(locator, /\.claude\/scripts\/codex-exec\.js/);
    assert.match(locator, /only when the destination is missing/i);
    assert.match(locator, /precommit-fast/, 'cites the auto-install precedent it reuses');
  });
  test('setup-required is not a Codex failure', () => {
    assert.match(locator, /setup-required/);
    assert.match(locator, /\*\*Not\*\* `codex_fail`/, 'an absent adapter must not route to a fallback reviewer');
  });
  test('a protocol mismatch asks for an explicit forced reinstall and never overwrites', () => {
    assert.match(locator, /protocol_mismatch/);
    assert.match(locator, /install-scripts codex-exec\.js --force/);
    assert.match(locator, /[Nn]ever overwrite a conflicting\s+installed adapter automatically/);
  });
  test('the locator runs before the scope baseline is frozen', () => {
    assert.match(locator, /before\*{0,2} the scope baseline is frozen/);
  });
});

describe('§ Files — one alloc per dispatch, adapter-owned modes, no repo writes', () => {
  const files = sectionOf(ref, 'Files');
  test('a resume gets a fresh directory', () => {
    assert.match(files, /\*\*fresh\*\* directory, never the previous one/);
  });
  test('the prompt is written with the Write tool, never a heredoc', () => {
    assert.match(files, /\*\*Write tool\*\*/);
    assert.match(files, /never a shell heredoc/);
    assert.match(files, /smart-commit/, 'cites the precedent');
  });

  // The general rule alone was what this suite asserted, and a doc reviewer showed why that is not
  // enough: the rule's phrases survive verbatim while the document acquires an exemption beside
  // them, so the suite passes on a contract that now says two things. Assert BOTH halves — the rule
  // and the single exemption — so neither can be edited away without the other being noticed.
  test('the one Write exemption is stated, named, and justified beside the rule', () => {
    assert.match(files, /One caller is exempt/i, 'the exemption must be stated, not implied');
    assert.match(files, /plan-review/, 'it must name which caller');
    assert.match(files, /ExitPlanMode/, 'and why: plan mode withholds Write before that boundary');
    assert.match(files, /PLAN_EOF_/, 'and the compensating control it substitutes');
  });

  test('the exemption is singular — a second one may not be added silently', () => {
    const exemptClaims = (files.match(/\bexempt\w*/gi) || []).length;
    assert.ok(exemptClaims <= 2, `§ Files claims exemption ${exemptClaims} times; one caller is exempt`);
  });

  test('the prompt-mode row does not restate the rule unconditionally', () => {
    const row = files.split('\n').find((l) => l.includes('Preflight on the **prompt**'));
    assert.ok(row, 'the layered-guarantee table must still carry the prompt row');
    assert.match(row, /except `plan-review`/,
      'the row asserted the Write tool unconditionally while the section above exempted a caller');
  });
  test('modes are the adapter’s and no dedicated shell grant is added', () => {
    assert.match(files, /0600/);
    assert.match(files, /No dedicated `mktemp`, `chmod` or `rm` command grant is needed or added/);
    // The earlier wording said no such permission "is granted", which a reviewer showed is not
    // something this document can promise: callers retaining `Bash(bash:*)` can run all three. The
    // claim has to be about what the contract REQUIRES, so pin the disclaimer too — dropping it
    // would restore a capability claim the permission section elsewhere denies making.
    assert.match(files, /not a capability bound/,
      'the sentence must say it describes the contract, not the caller’s effective authority');
  });
  test('no review artifact is written inside the repository', () => {
    // The claim used to read "Nothing is written inside the repository", which a doc reviewer showed
    // is false of the locator's one-time install at `.claude/scripts/codex-exec.js`. Pin the
    // narrowed claim AND its carve-out, so neither half can be dropped back to the absolute form.
    assert.match(files, /No prompt or report artifact is written inside the repository/);
    assert.match(files, /one-time setup write, not a review artifact/);
  });
});

describe('§ Completion state machine — scoped, and a launch is not a verdict', () => {
  const sm = sectionOf(ref, 'Completion state machine');
  test('the section is scoped to start and resume', () => {
    assert.match(sm, /\*\*This section governs `start` and `resume` only\.\*\*/);
  });
  test('launched means pending — no verdict, probe or note yet', () => {
    assert.match(sm, /a launch is \*\*not\*\* a verdict/);
    assert.match(sm, /pending/);
  });
  test('the three exit codes map to distinct readings, and exit 2 dispatches nothing', () => {
    assert.match(sm, /Exit 0 \| `codex_ok`/);
    assert.match(sm, /Exit 1 \| `codex_fail`/);
    assert.match(sm, /\*\*no reviewer was dispatched\*\*, so no fallback and no note/);
  });
  test('unknown completion keeps the gate open', () => {
    assert.match(sm, /Completion status unknown \| The gate \*\*stays open\*\*/);
  });
  test('alloc/cleanup failures are lifecycle errors, never Codex outcomes', () => {
    assert.match(sm, /never calls\s*`review-dispatch\.js`, never sets the probe, and never counts as a Codex outcome/);
  });
  test('a long dispatch runs in the background and the adapter owns no timeout', () => {
    assert.match(sm, /run_in_background: true/);
    assert.match(sm, /adapter owns no timeout and never retries/);
  });
});

describe('§ Start / § Resume — class ownership and the approval delta', () => {
  test('implement belongs to codex-implement alone; everything else is review', () => {
    const start = sectionOf(ref, 'Start');
    assert.match(start, /--class implement/);
    assert.match(start, /skills\/codex-implement\//);
    assert.match(start, /every other skill[^.]*`--class review`/);
  });
  test('the on-failure → never mapping is stated as a deliberate delta with its reason', () => {
    const start = sectionOf(ref, 'Start');
    assert.match(start, /approval_policy="never"/);
    assert.match(start, /non-interactive/);
    assert.match(start, /Step 3b/, 'names the human control that replaces on-failure');
  });
  test('§ Resume takes the CALLER’s class and preserves it across the thread', () => {
    // Regression pin for the P1 found in ticket 2 round 1: § Resume hard-coded `--class review`,
    // which would have silently downgraded every codex-implement continuation to read-only once
    // item 4 converted it. Reverting that line must fail here — Guard 3 skips this file wholesale,
    // so nothing else would notice.
    const resume = sectionOf(ref, 'Resume');
    assert.match(resume, /--class <the caller's class>/,
      '§ Resume must not name one class in its command line');
    assert.doesNotMatch(resume.split('```')[1] || '', /--class\s+review\b/,
      'the resume command line must not hard-code the review class');
    assert.match(resume, /class is the caller's/);
    assert.match(resume, /does not change across a thread/);
    assert.match(resume, /codex-implement.*--class implement/s, 'maps the write-capable caller');
    assert.match(resume, /every other caller resumes with `--class review`/);
  });

  test('§ Resume keeps the threadId term and leaves rotation behaviour-layer', () => {
    const resume = sectionOf(ref, 'Resume');
    assert.match(resume, /threadId/);
    assert.match(resume, /\bstart\b/, 'a rotation dispatches start, not resume');
    assert.match(resume, /THREAD_ROTATED/);
    assert.match(resume, /adapter\s+knows nothing about rounds or rotation/);
  });
});

describe('§ Profile — one knob, fail-closed, not tier-dependent', () => {
  const profile = sectionOf(ref, 'Profile');
  test('it reads the project setting and fail-closes on a missing profile file', () => {
    assert.match(profile, /## Codex Profile/);
    assert.match(profile, /\$CODEX_HOME\/<name>\.config\.toml/);
    assert.match(profile, /silently/, 'states why an unset profile cannot be trusted');
  });
  test('v1 is explicitly not tier-dependent', () => {
    assert.match(profile, /\*\*Profile selection is not tier-dependent in v1\.\*\*/);
    assert.match(profile, /tier-to-profile map is a future setting/);
  });
});

describe('the setting is declared where its consumers look', () => {
  test('auto-loop.md § Override Contract carries the row naming the transport as consumer', () => {
    const oc = sectionOf(autoLoop, 'Override Contract');
    assert.match(oc, /\| `## Codex Profile` \| Setting — .*codex-transport\.md` § Profile/);
    assert.match(oc, /the other seven name no section at all/, 'the count moves with the row');
  });
  test('the project scaffold has the heading', () => {
    assert.ok(project.split('\n').some((l) => l.trim() === '## Codex Profile'));
  });
});

describe('rules/codex-invocation.md — transport moved out, anti-anchoring intact', () => {
  test('it points at the canonical reference and claims no transport of its own', () => {
    assert.match(invocation, /codex-transport\.md/);
    assert.match(invocation, /How a prompt is carried is not this file's subject/);
  });
  test('it names no carrier tool', () => {
    assert.ok(!/mcp__codex/.test(invocation), 'the MCP tool name must be gone from this rule');
  });
  test('§ Prohibited patterns is equality-pinned in FULL — every cell, not just the row key', () => {
    // Two weaker versions failed here: sampling six strings let three rows be deleted, and pinning
    // only the first cell let the `Leading question` rationale be reversed to "Anchoring is
    // permitted" while staying green. The rationale column IS the anti-anchoring contract, so the
    // whole normalized table body is pinned. Escaped pipes are unescaped before splitting so a
    // future `\|` inside a cell cannot silently shift the columns.
    const table = sectionOf(invocation, 'Prohibited patterns');
    const rows = table.split('\n')
      .filter((l) => l.trim().startsWith('|') && !/^\|[\s-]+\|/.test(l.trim()))
      .map((l) => l.trim().replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.replace(/\\\|/g, '|').replace(/\s+/g, ' ').trim()));
    assert.deepEqual(rows[0], ['Pattern', 'Example', "Why it's wrong"], 'header drifted');
    assert.deepEqual(rows.slice(1).map((r) => r[0]), [
      'Feeding full diff/content',
      'Feeding code',
      'Feeding conclusion',
      'Leading question',
      'Scope restriction',
      'Confirmation prompt',
      'Cumulative attack list',
    ], 'a prohibited-pattern row was added or removed');
    assert.deepEqual(rows.slice(1).map((r) => r[1]), [
      '`"## Git Diff \\`\\`\\`diff … 2000 lines …\\`\\`\\`"`',
      '`"Here\'s the fix: \\`\\`\\`code\\`\\`\\` Is it correct?"`',
      '`"Claude found the bug is in X, confirm?"`',
      '`"I think the problem is caching, verify?"`',
      '`"Only look at src/service/"`',
      '`"These fixes look good, right?"`',
      'Each re-dispatch or fallback dispatch appends prior findings or aims the reviewer at named tests/guards/mutations',
    ], 'an example was changed — the examples are what make each prohibition recognizable');
    assert.deepEqual(rows.slice(1).map((r) => r[2]), [
      'Burns tokens and hands Codex a truncated slice instead of full context',
      'Codex sees only what you showed; it cannot find what you missed',
      'Presupposes the answer — Codex will not challenge it',
      'Anchors Codex to your hypothesis',
      'Prevents discovery in related files, which is where the second opinion pays',
      'Invites agreement, not analysis',
      'Feeding attack directions is feeding conclusions in mirror image — review depth grows round over round. Every first, fallback, and rotated dispatch is the fixed template plus current task metadata; dispatcher-authored attack programmes stay out',
    ], 'a rationale was reworded — that is an anti-anchoring contract change, not a copy edit');
    assert.equal(rows.length, 8, 'the table is exactly a header plus seven rows');
  });

  test('every anti-anchoring clause survives verbatim', () => {
    for (const clause of [
      'Codex must independently research. Never feed it your conclusions.',
      'providing the new diff is fine',
      'the exception is scoped to the thread, never to the task',
      'Did the fixes introduce new issues?',
      'Never paste the diff or the code itself',
      'Cumulative attack list',
    ]) {
      assert.ok(invocation.includes(clause), `lost anti-anchoring clause: ${clause}`);
    }
  });
  test('the same-thread exception names § Resume and keeps its pinned phrase', () => {
    // `review-loop-resilience.test.js` pins the phrase `continuing **the same thread**`; the
    // carrier name in front of it is the only part this migration may change.
    assert.match(invocation, /§ Resume dispatch continuing \*\*the same thread\*\*/);
  });
});

describe('§ Files — the plan-mode prompt-writing recipe is executable, not just documented', () => {
  // A doc reviewer measured the first version of this recipe failing on the STOCK template, and the
  // failure was not merely "the file is wrong": the body's words reached the shell as commands.
  // A prose warning cannot decay safely, so both shapes are executed here against the real template.
  const files = sectionOf(ref, 'Files');
  const TEMPLATE = join(ROOT, 'skills/plan-review/references/codex-prompt-plan.md');

  test('the stock template really does contain an apostrophe — the hazard needs no hostile input', () => {
    assert.match(readFileSync(TEMPLATE, 'utf8'), /'/,
      'if this ever stops holding, the measured failure below no longer reproduces from stock files');
  });

  test('the reference documents the outer-heredoc shape and names the nested one as forbidden', () => {
    assert.match(files, /bash -c 'cat > "\$1"' _/, 'the safe shape must be the one written down');
    assert.match(files, /Never nest the heredoc inside the `bash -c` argument/);
  });

  const runShape = (script) => {
    const dir = mkdtempSync(join(tmpdir(), 'transport-recipe-'));
    const sh = join(dir, 'run.sh');
    writeFileSync(sh, script.replace(/__OUT__/g, join(dir, 'out.md')));
    const r = spawnSync('bash', [sh], { encoding: 'utf8' });
    const out = existsSync(join(dir, 'out.md')) ? readFileSync(join(dir, 'out.md'), 'utf8') : null;
    rmSync(dir, { recursive: true, force: true });
    return { out, stderr: r.stderr };
  };

  // One payload, both shapes. Every character here is one the stock templates actually carry.
  const BODY = 'Attack Claude\'s plan, not $VAR or `date` or "quotes".';

  test('the documented shape writes the body byte-for-byte, metacharacters included', () => {
    const { out } = runShape(
      `bash -c 'cat > "$1"' _ '__OUT__' <<'PLAN_EOF_a1b2c3d4'\n${BODY}\nPLAN_EOF_a1b2c3d4\n`);
    assert.equal(out, `${BODY}\n`, 'no interpolation, no truncation, no command substitution');
  });

  test('the forbidden shape truncates the body and leaks it to the shell — so the warning is earned', () => {
    const nested = `bash -c 'cat > "__OUT__" <<'"'"'PLAN_EOF_a1b2c3d4'"'"'\n${BODY}\nPLAN_EOF_a1b2c3d4\n'\n`;
    const { out, stderr } = runShape(nested);
    assert.notEqual(out, `${BODY}\n`, 'if this ever matches, the recipe above is no longer load-bearing');
    assert.match(out ?? '', /Claudes/, 'the apostrophe closed the quote and the body was truncated there');
    assert.match(stderr, /command not found|unexpected EOF/,
      'body words reached the shell as commands — the reason this shape is forbidden');
  });
});

describe('body-only templates carry no expression that nothing evaluates', () => {
  // Stripping the `mcp__codex__codex({ prompt: `…` })` envelope removed the ONLY evaluator these
  // templates ever had. A `${X || 'default'}` left behind is no longer a default — it is literal text
  // written into prompt.md and shipped to Codex. Two survived the conversion, one of them pinned by a
  // test that asserted the broken form.
  //
  // Three earlier versions of this guard each claimed more than they did, and a reviewer measured
  // every one: a hand-kept inventory nothing forced to match reality; a BLACKLIST of `||` and
  // ternaries that waved through `${X ?? d}`, `${X && Y}` and `${X.trim()}`; and a fence-stripper
  // built on the false premise that fenced blocks are shell — `${GIT_DIFF}` and `${RELEVANT_DIFF}`
  // live inside `diff` and `json` fences, so stripping them hid exactly the fields most worth
  // checking. What this version does instead: scan the WHOLE file (no fence parsing at all, because
  // measurement showed no scanned template contains shell parameter expansion), and whitelist the
  // interior rather than blacklisting shapes.
  const PLACEHOLDER = /^[A-Z][A-Z0-9_]*$/;
  // An actual envelope at the start of a line, not any mention of the token: a file that merely
  // names `mcp__codex__codex(` in prose is still body-only and must still be scanned.
  const HAS_ENVELOPE = /^\s*mcp__codex__codex\(\{/m;

  const templates = () => {
    const out = [];
    for (const skill of readdirSync(join(ROOT, 'skills'))) {
      const dir = join(ROOT, 'skills', skill, 'references');
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.md')) continue;
        if (!(f.includes('prompt') || f.startsWith('review-loop-') || f === 'review-common.md')) continue;
        const p = join(dir, f);
        if (!HAS_ENVELOPE.test(readFileSync(p, 'utf8'))) out.push(p);
      }
    }
    return out.sort();
  };

  test('what this guard covers, stated exactly — it is a convention scan, not a class proof', () => {
    // Said plainly because three earlier versions of this test were named for a guarantee they did
    // not deliver. Discovery is: immediate `skills/*/references/` children whose basename contains
    // `prompt`, or starts with `review-loop-`, or is `review-common.md`, minus those carrying the MCP
    // envelope. A prompt body living anywhere else, or named otherwise, is NOT covered — closing that
    // needs a declared marker on each prompt artifact (frontmatter, or a registry the call sites
    // derive from), which is a change to every template and belongs in its own request.
    const rels = templates().map((p) => p.slice(ROOT.length + 1));
    for (const must of [
      'skills/codex-code-review/references/codex-prompt-full.md',
      'skills/codex-code-review/references/review-common.md',
      'skills/doc-review/references/review-loop-doc.md',
      'skills/plan-review/references/codex-prompt-plan.md',
      'skills/seek-verdict/references/verdict-prompt.md',
      'skills/test-review/references/codex-prompt-ac-trace.md',
    ]) assert.ok(rels.includes(must), `${must} must be scanned`);
    // Work item 5 converted test-gen together with its owner `codex-test-gen`, so it is now in the
    // scanned set rather than excluded from it. This assertion flipped with the conversion: while
    // the file carried the MCP envelope its `||` defaults were real JavaScript, and now nothing
    // evaluates them.
    assert.ok(rels.includes('skills/test-review/references/codex-prompt-test-gen.md'),
      'test-gen is converted now, so the expression scan must cover it');
    assert.ok(rels.length >= 11, `expected at least the migrated set, got ${rels.length}`);
  });

  for (const p of templates()) {
    const rel = p.slice(ROOT.length + 1);
    test(`${rel}: every \${…} is a bare placeholder, fences included`, () => {
      const offenders = [...readFileSync(p, 'utf8').matchAll(/\$\{([^}]*)\}/g)]
        .map((m) => m[1].trim())
        .filter((inner) => !PLACEHOLDER.test(inner));
      assert.deepEqual(offenders, [],
        `${rel}: nothing evaluates these — bind the value before writing prompt.md, or use an explicit conditional marker`);
    });
  }
});

// ---------------------------------------------------------------------------
// Locator ordering: resolve (and possibly install) the adapter before snapshotting
// ---------------------------------------------------------------------------
// `codex-transport.md` § Locator: "Locator resolution and any auto-install happen **before** the
// scope baseline is frozen, so an install cannot move the digest under a review that has already
// started." In a consuming repository the locator's step 2 *writes* `.claude/scripts/codex-exec.js`,
// so a skill that snapshots the tree first ends up with a frozen set that does not contain a file
// its own dispatch created. Found by review on 2026-09-04, when both skills below dispatched from a
// later step than the one that froze their snapshot.
describe('a snapshotting caller resolves the locator before it snapshots', () => {
  // Only the two callers that freeze something. A dispatcher that takes no snapshot has nothing to
  // invalidate, and listing it here would assert an ordering it does not need.
  const CASES = [
    {
      file: 'skills/codex-code-review/SKILL.md',
      snapshot: '**Scope baseline (frozen here).**',
      what: 'the frozen scope baseline',
    },
    {
      file: 'skills/codex-implement/SKILL.md',
      snapshot: '`git status --porcelain --untracked-files=all --ignored`',
      what: 'the changeset snapshot the rollback baseline is derived from',
    },
  ];
  const LOCATOR = /codex-transport\.md`?\s*\n?\s*§ Locator|§ Locator/;

  for (const { file, snapshot, what } of CASES) {
    test(`${file}: § Locator is cited before ${what}`, () => {
      const text = readFileSync(join(ROOT, file), 'utf8');
      const snapAt = text.indexOf(snapshot);
      assert.notEqual(snapAt, -1, `the snapshot anchor moved — update this test, not the anchor`);
      const locAt = text.search(LOCATOR);
      assert.notEqual(locAt, -1, `${file} never cites § Locator, so nothing resolves the adapter`);
      assert.ok(locAt < snapAt,
        `${file} snapshots at ${snapAt} and resolves the adapter only at ${locAt} — an auto-install would land after the snapshot`);
    });
  }

  test('the ordering check fails when the two are swapped', () => {
    // Negative control: the same two anchors in the wrong order must be rejected, or the assertion
    // above would pass on any document that merely contains both strings.
    const swapped = 'Step 1: **Scope baseline (frozen here).**\nStep 3: dispatch per § Locator.';
    const snapAt = swapped.indexOf('**Scope baseline (frozen here).**');
    const locAt = swapped.search(LOCATOR);
    assert.ok(snapAt !== -1 && locAt !== -1, 'both anchors present in the control');
    assert.ok(!(locAt < snapAt), 'the control must be rejected by the same comparison');
  });
});

// The MCP envelope evaluated `${FUNCTION_NAME || 'all'}` as JavaScript; the exec transport writes
// prompt.md as text, so a template default is inert and the binding has to be stated by the skill
// that renders it. Found by review on 2026-09-04: the file-only invocation the skill documents
// (`/codex-test-gen <file>`) had nothing left to resolve the placeholder to.
test('the file-only test-gen invocation has a stated FUNCTION_NAME binding', () => {
  const skill = readFileSync(join(ROOT, 'skills/test-review/SKILL.md'), 'utf8');
  const gen = readFileSync(join(ROOT, 'skills/test-review/references/codex-prompt-test-gen.md'), 'utf8');
  assert.match(gen, /\$\{FUNCTION_NAME\}/, 'the template still carries the placeholder');
  assert.match(skill, /FUNCTION_NAME/,
    'the owning workflow must name the placeholder it binds — nothing else renders it');
  assert.match(skill, /`all`/,
    'and must state the file-only default, or the documented invocation renders an empty scope');
  // Negative control: naming the token without a default is the state this test was added to reject.
  const weak = 'Bind FUNCTION_NAME from the invocation.';
  assert.ok(/FUNCTION_NAME/.test(weak) && !/`all`/.test(weak),
    'a binding sentence with no default must not satisfy both assertions');
});

// § Locator step 2 has to find the adapter in every layout Claude Code installs plugins into. The
// one-sided form it carried until 2026-09-04 — `plugins/**/sd0x-dev-flow/scripts/…` — requires
// `scripts` to be an immediate child of the plugin directory, so it missed a versioned marketplace
// cache entirely. Found by item 6's live acceptance, which could not resolve the adapter through the
// documented cascade at all.
test('the plugin locator glob reaches a versioned marketplace cache', () => {
  const locator = sectionOf(ref, 'Locator');
  const m = locator.match(/`(~\/\.claude\/plugins\/[^`]*codex-exec\.js)`/);
  assert.ok(m, 'the plugin-copy glob must be stated in § Locator');
  const pattern = m[1].replace('~', '');

  const dir = mkdtempSync(join(tmpdir(), 'locator-'));
  try {
    const layouts = {
      marketplace: '.claude/plugins/marketplaces/m/plugins/sd0x-dev-flow/scripts',
      cacheFlat: '.claude/plugins/cache/mk2/sd0x-dev-flow/scripts',
      cacheVersioned: '.claude/plugins/cache/mk/sd0x-dev-flow/4.5.0/scripts',
    };
    for (const rel of Object.values(layouts)) {
      require('node:fs').mkdirSync(join(dir, rel), { recursive: true });
      writeFileSync(join(dir, rel, 'codex-exec.js'), '// fixture\n');
    }
    const hits = require('node:fs').globSync(join(dir, pattern)).map((p) => p.slice(dir.length));
    for (const [name, rel] of Object.entries(layouts)) {
      assert.ok(hits.some((h) => h.includes(rel)), `the glob must reach the ${name} layout`);
    }
    // Negative control: the one-sided form must NOT satisfy this test, or the test proves nothing.
    const oneSided = '/.claude/plugins/**/sd0x-dev-flow/scripts/codex-exec.js';
    const oldHits = require('node:fs').globSync(join(dir, oneSided));
    assert.equal(oldHits.some((h) => h.includes(layouts.cacheVersioned)), false,
      'control: the pre-2026-09-04 glob really did miss the versioned cache');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
