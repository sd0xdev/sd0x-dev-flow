const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../skills/orchestrate/scripts/validate-plan.js');
const scriptTestPath = __filename; // this file — one test below inspects the harness it shares
const tempDirs = [];

const CONTEXT = {
  budget: { tier: 'M', max_workers: 3, max_waves: 2, max_plan_steps: 15 },
  admission: { mode: 'deny-by-default', allowlist: ['Explore', 'performance-optimizer'] },
  skill_candidates: [
    { command: '/codex-review-doc' },
    { command: '/update-docs' },
    { command: '/codex-implement' },
  ],
};

function basePlan() {
  return {
    intent: 'audit hook fail-open paths',
    done_definition: 'findings report written and doc-reviewed',
    steps: [
      { id: 's1', kind: 'fanout', target: 'Explore', why: 'repo-wide hook research needs read fanout', parallel_group: 'w1' },
      { id: 's2', kind: 'verify', target: 'run-verify', why: 'post-execute no-change proof', depends_on: ['s1'] },
    ],
    stop_conditions: ['budget exhausted'],
    required_gates: ['doc-review'],
  };
}

// A file-backed --context now REQUIRES its digest, so the shared harness mirrors the real
// workflow: hash exactly the bytes written, and pass that as --context-sha256. Tests that need
// the unhappy paths (omitted digest, wrong digest) call the CLI directly instead.
function runValidate(plan, context = CONTEXT) {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-lint-'));
  tempDirs.push(dir);
  const contextRaw = JSON.stringify(context);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  writeFileSync(join(dir, 'context.json'), contextRaw);
  const digest = createHash('sha256').update(contextRaw, 'utf8').digest('hex');
  try {
    const stdout = execFileSync(
      'node',
      [scriptPath, '--plan', join(dir, 'plan.json'), '--context', join(dir, 'context.json'), '--context-sha256', digest],
      { encoding: 'utf8' }
    );
    return { output: JSON.parse(stdout), exitCode: 0 };
  } catch (err) {
    const stdout = (err.stdout || '').toString();
    return {
      output: stdout ? JSON.parse(stdout) : null,
      exitCode: err.status,
      stderr: (err.stderr || '').toString(),
    };
  }
}

function rules(result) {
  return result.output.violations.map((v) => v.rule);
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test('validate-plan: conforming read-only plan → exit 0 {ok:true}', () => {
  const result = runValidate(basePlan());
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.output, { ok: true });
});

test('validate-plan SCHEMA: null plan → structured violation, not a TypeError crash', () => {
  const result = runValidate(null);
  assert.equal(result.exitCode, 1);
  assert.ok(result.output && Array.isArray(result.output.violations), 'must emit {ok:false,violations}, not crash');
  assert.ok(rules(result).includes('SCHEMA'));
  assert.match(result.output.violations[0].message, /plan must be a JSON object/);
  assert.doesNotMatch(result.stderr || '', /TypeError/, 'must not dereference a non-object');
});

test('validate-plan SCHEMA: null context → structured violation, not a TypeError crash', () => {
  const result = runValidate(basePlan(), null);
  assert.equal(result.exitCode, 1);
  assert.ok(result.output && Array.isArray(result.output.violations));
  assert.match(result.output.violations[0].message, /context must be a JSON object/);
  assert.doesNotMatch(result.stderr || '', /TypeError/);
});

test('validate-plan SCHEMA: non-object step entry → reported, valid steps still validated', () => {
  const plan = basePlan();
  // A null and a scalar step interleaved with a valid one: null would throw on step.id
  // pre-fix; scalars auto-box to undefined and produce garbage rules. Both must become
  // clean SCHEMA violations while s1/s2 continue to validate normally.
  plan.steps = [null, 42, ...plan.steps];
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stderr || '', /TypeError/, 'null step must not crash step.id access');
  const schemaMsgs = result.output.violations.filter((v) => v.rule === 'SCHEMA').map((v) => v.message);
  assert.equal(schemaMsgs.filter((m) => /each step must be a JSON object/.test(m)).length, 2, 'both bad steps flagged');
});

test('validate-plan A4: null/scalar skill_candidate element → no TypeError crash, structured output', () => {
  // strict iter-16 Nit: the A4 candidate-set build did `skill_candidates.map((s) => s.command)`
  // unguarded, so a null/scalar element (a plugin-generation bug) threw an uncaught
  // `TypeError: Cannot read properties of null (reading 'command')` — a stack-trace crash with empty
  // stdout instead of the structured {ok:false,violations} every other malformed-input path produces.
  // The fix filters to plain objects first. A dropped garbage candidate is simply not a valid target,
  // so A4 stays fail-closed; a conforming plan whose good candidates survive still passes.
  const context = {
    ...CONTEXT,
    skill_candidates: [{ command: '/codex-review-doc' }, null, 42, { command: '/update-docs' }],
  };
  const result = runValidate(basePlan(), context);
  assert.doesNotMatch(result.stderr || '', /TypeError/, 'a null/scalar skill_candidate must not crash the A4 candidate map');
  assert.ok(result.output, 'must emit structured JSON output, not crash with empty stdout');
  // basePlan is conforming and the two valid candidates survive the filter, so it still passes.
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.output, { ok: true });
});

test('validate-plan A4: a candidate object missing `command` must NOT let a targetless main-skill step bypass A4 (strict iter-18 P2)', () => {
  // strict iter-18 P2: the A4 candidate-set build filtered to plain objects but still `.map`-ped a
  // command-less object to `undefined`, seeding the Set with `undefined`. A main-skill step whose
  // target is missing/undefined then PASSED A4 because `skillCommands.has(undefined) === true` — an
  // anti-hallucination bypass (validate-plan.js is a standalone CLI accepting arbitrary --context JSON,
  // exactly why the shape guards exist). The `typeof s.command === 'string'` filter keeps the Set
  // string-only, so has(undefined) is false and the targetless step is correctly rejected.
  // Non-tautology: drop the `typeof s.command === 'string'` guard → `undefined` re-enters the Set →
  // this targetless step is silently accepted (exit 0, no A4).
  const context = {
    ...CONTEXT,
    skill_candidates: [{ command: '/codex-review-doc' }, { name: 'malformed-no-command' }],
  };
  const plan = basePlan();
  plan.steps.push({ id: 's3', kind: 'main-skill', why: 'advisory doc-review handoff' }); // NO target field
  const result = runValidate(plan, context);
  assert.equal(result.exitCode, 1, 'a targetless main-skill step must be rejected, not silently accepted via has(undefined)');
  assert.ok(rules(result).includes('A4'), 'A4 must fire when the main-skill target is undefined and not a real candidate');
});

test('validate-plan A1: fanout target outside allowlist → exit 1 (deny-by-default)', () => {
  const plan = basePlan();
  plan.steps[0].target = 'git-investigator';
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  assert.ok(rules(result).includes('A1'));
  assert.match(result.output.violations.find((v) => v.rule === 'A1').message, /deny-by-default/);
});

test('validate-plan A2+A3: fanout declaring mutating:true → both contradiction rules fire', () => {
  const plan = basePlan();
  plan.steps[0].mutating = true;
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  assert.ok(rules(result).includes('A2'));
  assert.ok(rules(result).includes('A3'), 'mutating without proposed-manual also breaks A3');
});

test('validate-plan A3/G1: code-class mutation must be proposed-manual with code gates', () => {
  const plan = basePlan();
  plan.steps.push({ id: 's3', kind: 'main-skill', target: '/codex-implement', why: 'apply the fix', mutating: true });
  const blocked = runValidate(plan);
  assert.equal(blocked.exitCode, 1);
  assert.ok(rules(blocked).includes('A3'));
  assert.ok(rules(blocked).includes('G1'), 'unclassified mutation defaults to code → needs code-review + precommit');

  plan.steps[2].kind = 'proposed-manual';
  plan.required_gates = ['doc-review', 'code-review', 'precommit'];
  const ok = runValidate(plan);
  assert.equal(ok.exitCode, 0);
});

test('validate-plan A4: hallucinated main-skill target → rejected; real candidate passes', () => {
  const plan = basePlan();
  plan.steps.push({ id: 's3', kind: 'main-skill', target: '/does-not-exist', why: 'review the findings report' });
  const blocked = runValidate(plan);
  assert.equal(blocked.exitCode, 1);
  assert.ok(rules(blocked).includes('A4'));
  assert.match(blocked.output.violations.find((v) => v.rule === 'A4').message, /not found in plan-context/);

  plan.steps[2].target = '/codex-review-doc';
  const ok = runValidate(plan);
  assert.equal(ok.exitCode, 0);
});

test('validate-plan A4: context without skill_candidates → fail-closed on main-skill steps', () => {
  const plan = basePlan();
  plan.steps.push({ id: 's3', kind: 'main-skill', target: '/codex-review-doc', why: 'review the report' });
  const { skill_candidates: _omitted, ...contextWithoutCandidates } = CONTEXT;
  const result = runValidate(plan, contextWithoutCandidates);
  assert.equal(result.exitCode, 1);
  assert.ok(rules(result).includes('A4'));
  assert.match(result.output.violations.find((v) => v.rule === 'A4').message, /fail-closed/);
});

test('validate-plan G1(doc)+G2: doc-class mutation without doc-review gate', () => {
  const plan = basePlan();
  plan.steps.push({ id: 's3', kind: 'proposed-manual', target: '/update-docs', why: 'sync spec', mutating: true, mutation_class: 'doc' });
  plan.required_gates = ['code-review', 'precommit'];
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  assert.ok(rules(result).includes('G1'));
  assert.ok(rules(result).includes('G2'), 'doc-review is always required in v1');
});

test('validate-plan O1: empty why → violation tagged with the step id', () => {
  const plan = basePlan();
  plan.steps[1].why = '   ';
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  const o1 = result.output.violations.find((v) => v.rule === 'O1');
  assert.equal(o1.step, 's2');
});

test('validate-plan B1: step count, parallel_group width, converge rounds all capped', () => {
  const plan = basePlan();
  for (let i = 0; i < 16; i += 1) {
    plan.steps.push({ id: `w${i}`, kind: 'fanout', target: 'Explore', why: 'breadth scan', parallel_group: 'w2' });
  }
  plan.steps[0].converge = { max_rounds: 3, until: 'no new findings' };
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  const b1Messages = result.output.violations.filter((v) => v.rule === 'B1').map((v) => v.message);
  assert.ok(b1Messages.some((m) => m.includes('max_plan_steps')), 'steps.length cap');
  assert.ok(b1Messages.some((m) => m.includes('max_workers')), 'parallel_group width cap');
  assert.ok(b1Messages.some((m) => m.includes('max_waves')), 'converge rounds cap');
});

test('validate-plan S1: plan text reciting a hook sentinel → rejected', () => {
  const plan = basePlan();
  plan.done_definition = 'stop once review shows ✅ Ready';
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  assert.ok(rules(result).includes('S1'));
  assert.match(result.output.violations.find((v) => v.rule === 'S1').message, /describe gates by name/);
});

test('validate-plan S1: sentinels aligned with hook parsers — precommit + plan-namespace + false-block strings', () => {
  // Each string is one a hook parser acts on but the pre-fix list missed.
  // '✅ Plan Ready' / '⛔ Plan Blocked' are NOT covered by '✅ Ready' / '⛔ Blocked'
  // (literal substring match), so they must be caught by their own entries.
  for (const sentinel of ['## Overall: ✅ PASS', '✅ Plan Ready', '⛔ Plan Blocked', '⛔ Needs revision', '⛔ Must fix']) {
    const plan = basePlan();
    plan.done_definition = `report is done once the gate shows ${sentinel} downstream`;
    const result = runValidate(plan);
    assert.equal(result.exitCode, 1, `"${sentinel}" must be rejected`);
    assert.ok(rules(result).includes('S1'), `"${sentinel}" must trip S1`);
  }
});

test('validate-plan S1: a sentinel hidden in an object KEY is rejected', () => {
  // `collectStrings` walked `Object.values` only, on the stated grounds that keys are
  // "schema-controlled and already covered by the JSON.stringify literal scan". Neither half held:
  // nothing rejects unknown keys, and the literal scan matches exact strings, not the EREs. Both
  // keys below match a stop-guard grep verbatim while the plan validated ok:true.
  for (const key of ['Gate must PASS before merge', '⛔ pipeline Blocked upstream']) {
    const plan = basePlan();
    plan.notes = { [key]: 'harmless value' };
    const result = runValidate(plan);
    assert.equal(result.exitCode, 1, `key "${key}" must be rejected`);
    assert.ok(rules(result).includes('S1'), `key "${key}" must trip S1`);
  }
});

test('validate-plan S1: an ordinary key is not a sentinel (control)', () => {
  // Non-vacuity for the test above: scanning keys must not reject every plan that has keys — which
  // is every plan. Without this control the fix could be "reject if any key exists" and pass.
  const plan = basePlan();
  plan.notes = { rationale: 'the gate name is precommit', owner: 'team-a' };
  const result = runValidate(plan);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.equal(result.output.ok, true);
});

test('validate-plan B1: converge.max_rounds must be a POSITIVE INTEGER, not merely a number', () => {
  // `typeof === "number"` admitted 0, -1 and 0.5. An executor looping `round < max_rounds` runs
  // ZERO rounds for 0 or -1 — convergence silently skipped while the plan still validates — and a
  // fractional budget has no meaning in either direction. The string case is the easy half; these
  // three are the ones that used to pass.
  for (const bad of ['abc', 0, -1, 0.5, null, true]) {
    const plan = basePlan();
    plan.steps[0].converge = { max_rounds: bad, until: 'no new findings' };
    const result = runValidate(plan);
    assert.equal(result.exitCode, 1, `max_rounds ${JSON.stringify(bad)} must be rejected`);
    assert.match(
      result.output.violations.find((v) => v.rule === 'B1').message,
      /must be an integer >= 1/,
      `max_rounds ${JSON.stringify(bad)}`
    );
  }
});

test('validate-plan B1: a legitimate in-range max_rounds still passes (guard is not a blanket reject)', () => {
  const plan = basePlan();
  plan.steps[0].converge = { max_rounds: 1, until: 'no new findings' };
  assert.equal(runValidate(plan).exitCode, 0, 'the smallest meaningful budget must be accepted');
});

test('validate-plan SCHEMA: missing step id, non-array depends_on, empty done_definition rejected', () => {
  const plan = basePlan();
  plan.done_definition = '';
  plan.steps.push({ kind: 'fanout', target: 'Explore', why: 'id-less step cannot be tracked in steps_status' });
  plan.steps.push({ id: 's4', kind: 'verify', target: 'run-verify', why: 'final check', depends_on: 's1' });
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  const schemaMessages = result.output.violations.filter((v) => v.rule === 'SCHEMA').map((v) => v.message);
  assert.ok(schemaMessages.some((m) => m.includes('step.id is required')), 'missing id must be rejected');
  assert.ok(schemaMessages.some((m) => m.includes('depends_on must be an array')), 'string depends_on must be rejected');
  assert.ok(schemaMessages.some((m) => m.includes('plan.done_definition')), 'empty done_definition must be rejected');
});

test('validate-plan SCHEMA: duplicate step ids and dangling depends_on rejected', () => {
  const plan = basePlan();
  plan.steps.push({ id: 's1', kind: 'fanout', target: 'Explore', why: 'duplicate id smuggling' });
  plan.steps.push({ id: 's9', kind: 'verify', target: 'run-verify', why: 'final check', depends_on: ['ghost-step'] });
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  const schemaMessages = result.output.violations.filter((v) => v.rule === 'SCHEMA').map((v) => v.message);
  assert.ok(schemaMessages.some((m) => m.includes('duplicate step id')), 'duplicate id must be rejected');
  assert.ok(schemaMessages.some((m) => m.includes('unknown step id')), 'dangling depends_on must be rejected');
});

test('validate-plan SCHEMA: depends_on cycle → rejected (plan must be a DAG)', () => {
  const plan = basePlan();
  // s1 → s2 → s1: every id resolves, but the graph is not topologically
  // orderable, so execution-policy.md's topological run is unsatisfiable.
  plan.steps[0].depends_on = ['s2'];
  plan.steps[1].depends_on = ['s1'];
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.output.violations.some((v) => v.rule === 'SCHEMA' && /cycle/.test(v.message)),
    'a dependency cycle must be reported as a SCHEMA violation'
  );
});

test('validate-plan SCHEMA: linear depends_on chain (no cycle) → accepted', () => {
  const plan = basePlan();
  // s1 (no deps) → s2 depends on s1 → s3 depends on s2: a valid DAG.
  plan.steps.push({ id: 's3', kind: 'verify', target: 'run-verify', why: 'second-stage no-change proof', depends_on: ['s2'] });
  const result = runValidate(plan);
  assert.equal(result.exitCode, 0, 'a well-formed dependency chain must not be flagged as a cycle');
});

test('validate-plan SCHEMA: non-array steps and unknown kind fail closed', () => {
  const noSteps = runValidate({ intent: 'x', required_gates: ['doc-review'] });
  assert.equal(noSteps.exitCode, 1);
  assert.ok(rules(noSteps).includes('SCHEMA'));

  const plan = basePlan();
  plan.steps[0].kind = 'background-write';
  const badKind = runValidate(plan);
  assert.equal(badKind.exitCode, 1);
  assert.ok(rules(badKind).includes('SCHEMA'));
});

test('validate-plan: collects every violation in one pass, not just the first', () => {
  const plan = basePlan();
  plan.steps[0].target = 'coverage-analyst'; // A1
  plan.steps[1].why = ''; // O1
  plan.required_gates = []; // G2
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  const seen = new Set(rules(result));
  assert.ok(seen.has('A1') && seen.has('O1') && seen.has('G2'), `expected A1+O1+G2, got ${[...seen]}`);
});

test('validate-plan: missing or malformed input files → exit 1 with stderr reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-lint-'));
  tempDirs.push(dir);
  const contextRaw = JSON.stringify(CONTEXT);
  writeFileSync(join(dir, 'context.json'), contextRaw);
  writeFileSync(join(dir, 'broken.json'), '{not json');
  // The digest is mandatory for a file-backed context, so it must be supplied here too —
  // otherwise both cases would exit 1 for the WRONG reason and assert nothing about file reads.
  const digest = createHash('sha256').update(contextRaw, 'utf8').digest('hex');
  const ctxArgs = ['--context', join(dir, 'context.json'), '--context-sha256', digest];
  const missing = (() => {
    try {
      execFileSync('node', [scriptPath, '--plan', join(dir, 'absent.json'), ...ctxArgs], { encoding: 'utf8' });
      return null;
    } catch (err) {
      return err;
    }
  })();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr.toString(), /plan unreadable/);
  const malformed = (() => {
    try {
      execFileSync('node', [scriptPath, '--plan', join(dir, 'broken.json'), ...ctxArgs], { encoding: 'utf8' });
      return null;
    } catch (err) {
      return err;
    }
  })();
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr.toString(), /not valid JSON/);
});

test('validate-plan: a file-backed --context WITHOUT --context-sha256 is refused, not silently trusted', () => {
  // The packet lives in `.claude_workflows/`, a surface run-verify.js excludes from drift
  // detection and a Bash-capable planner can write to. When the digest was merely optional, the
  // documented workflow (which never passed one) validated a doctored `admission.allowlist` or a
  // fabricated `skill_candidates` entry clean — A1 and A4 bypassed with no record anywhere.
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-lint-nodigest-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(basePlan()));
  writeFileSync(join(dir, 'context.json'), JSON.stringify(CONTEXT));
  const err = (() => {
    try {
      execFileSync('node', [scriptPath, '--plan', join(dir, 'plan.json'), '--context', join(dir, 'context.json')], { encoding: 'utf8' });
      return null;
    } catch (e) {
      return e;
    }
  })();
  assert.ok(err, 'an unverified file-backed packet must not validate');
  assert.equal(err.status, 1);
  assert.match(err.stderr.toString(), /--context-sha256 is required/);
});

test('validate-plan: a STDIN context needs a digest too — the exemption was a bypass', () => {
  // This test previously pinned the exemption as INTENTIONAL, on the premise that `--context -`
  // is piped in-process from plan-context.js and so never lands on a writable surface. The
  // premise is false: plan-context.js REQUIRES `--out` and has no stdout-packet branch, so it
  // cannot feed a pipe at all. The only reachable route to `--context -` is `cat <file already
  // at rest under .claude_workflows/>` — the exact surface the file path is distrusted for, but
  // with integrity checking switched off by a one-character flag change.
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-lint-stdin-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(basePlan()));
  const err = (() => {
    try {
      execFileSync('node', [scriptPath, '--plan', join(dir, 'plan.json'), '--context', '-'], {
        encoding: 'utf8',
        input: JSON.stringify(CONTEXT),
      });
      return null;
    } catch (e) {
      return e;
    }
  })();
  assert.ok(err, 'stdin is not a trust boundary');
  assert.equal(err.status, 1);
  assert.match(err.stderr.toString(), /--context-sha256 is required/);
});

test('validate-plan: a STDIN context WITH a matching digest validates', () => {
  // The tightening must not remove the capability — stdin still works, it just has to be bound.
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-lint-stdin-ok-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(basePlan()));
  const body = JSON.stringify(CONTEXT);
  const digest = createHash('sha256').update(body, 'utf8').digest('hex');
  const stdout = execFileSync(
    'node',
    [scriptPath, '--plan', join(dir, 'plan.json'), '--context', '-', '--context-sha256', digest],
    { encoding: 'utf8', input: body }
  );
  assert.equal(JSON.parse(stdout).ok, true);
});

test('validate-plan: a TAMPERED stdin context is refused by its digest', () => {
  // The whole point: piping doctored bytes must now fail exactly as a doctored file does.
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-lint-stdin-tamper-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(basePlan()));
  const honest = JSON.stringify(CONTEXT);
  const digest = createHash('sha256').update(honest, 'utf8').digest('hex');
  const doctored = JSON.stringify({ ...CONTEXT, tampered_marker: true });
  const err = (() => {
    try {
      execFileSync(
        'node',
        [scriptPath, '--plan', join(dir, 'plan.json'), '--context', '-', '--context-sha256', digest],
        { encoding: 'utf8', input: doctored }
      );
      return null;
    } catch (e) {
      return e;
    }
  })();
  assert.ok(err, 'doctored stdin must not validate');
  assert.match(err.stderr.toString(), /context digest mismatch/);
});

// --- Context packet integrity (--context-sha256) ---
// plan-context.js --out writes the packet to `.claude_workflows/`, which run-verify.js
// deliberately EXCLUDES from drift detection and the Bash-capable planner can write to.
// Without re-hashing, a planner could add itself a denied agent to admission.allowlist
// (defeating A1) or invent a skill_candidates entry (defeating A4), return a plan matching
// its own edit, and validate clean with no drift recorded anywhere.
function runValidateWithDigest(plan, context, { digest, tamper } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-digest-'));
  tempDirs.push(dir);
  const contextPath = join(dir, 'context.json');
  const original = JSON.stringify(context);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  writeFileSync(contextPath, original);
  const sha = digest !== undefined ? digest : createHash('sha256').update(original, 'utf8').digest('hex');
  if (tamper) writeFileSync(contextPath, JSON.stringify(tamper(JSON.parse(original))));
  const argv = [scriptPath, '--plan', join(dir, 'plan.json'), '--context', contextPath, '--context-sha256', sha];
  try {
    return { output: JSON.parse(execFileSync('node', argv, { encoding: 'utf8' })), exitCode: 0 };
  } catch (err) {
    const stdout = (err.stdout || '').toString();
    return {
      output: stdout ? JSON.parse(stdout) : null,
      exitCode: err.status,
      stderr: (err.stderr || '').toString(),
    };
  }
}

test('validate-plan: matching --context-sha256 validates normally', () => {
  const res = runValidateWithDigest(basePlan(), CONTEXT);
  assert.equal(res.exitCode, 0, 'an untampered packet must pass the digest check');
  assert.equal(res.output.ok, true);
});

test('validate-plan: planner appending a denied agent to admission.allowlist is rejected by digest', () => {
  const res = runValidateWithDigest(basePlan(), CONTEXT, {
    tamper: (c) => {
      c.admission.allowlist.push('git-investigator');
      return c;
    },
  });
  assert.equal(res.exitCode, 1, 'a tampered packet must never reach A1 evaluation');
  assert.match(res.stderr || '', /digest mismatch/);
});

test('validate-plan: planner injecting a fabricated skill_candidate is rejected by digest', () => {
  const res = runValidateWithDigest(basePlan(), CONTEXT, {
    tamper: (c) => {
      c.skill_candidates = [...(c.skill_candidates || []), { command: '/exfiltrate' }];
      return c;
    },
  });
  assert.equal(res.exitCode, 1, 'A4 must not be satisfiable by editing the packet');
  assert.match(res.stderr || '', /digest mismatch/);
});

test('validate-plan: malformed --context-sha256 → exit 1', () => {
  const res = runValidateWithDigest(basePlan(), CONTEXT, { digest: 'not-a-digest' });
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr || '', /64-character lowercase hex/);
});

test('the shared harness always supplies a digest — no test using it can cover the omitted case', () => {
  // This replaces a test titled "omitting --context-sha256 stays backward compatible", whose body
  // was `runValidate(basePlan())` — and `runValidate` appends `--context-sha256` unconditionally.
  // So it exercised the ordinary happy path already covered above, under a name asserting the
  // OPPOSITE of the enforced contract: an omitted digest is refused (see the `--context-sha256 is
  // required` test). A green test claiming backward compatibility is worse than no test, because
  // "restoring" that compatibility to make it honest would reopen the A1/A4 packet-tampering
  // bypass the digest closes.
  //
  // What is worth pinning is the harness property that made the mistake invisible: any test routed
  // through `runValidate` is testing the digest-PRESENT path, whatever its title says.
  const source = readFileSync(scriptTestPath, 'utf8');
  const harness = source.slice(source.indexOf('function runValidate('));
  const body = harness.slice(0, harness.indexOf('\n}\n'));
  assert.match(
    body, /--context-sha256/,
    'runValidate must keep supplying the digest — the unhappy paths call the CLI directly'
  );
  // Anchored to the `test(` call site, not the whole file: the comment above quotes the retired
  // title on purpose, and a scan that cannot tell a citation from a declaration would force the
  // explanation to stop naming what it explains. (That confusion is the same shape as the bug this
  // whole round is about, so getting it right here is not incidental.)
  assert.doesNotMatch(
    source, /\btest\(\s*['"`][^'"`]*omitting --context-sha256/,
    'the misleading title must not come back as a real test'
  );
});

test('S1: `Gate must PASS` in a why field is rejected (stop-guard matches regexes, not literals)', () => {
  // The literal FORBIDDEN_SENTINELS list cannot express stop-guard.sh:551,604's `Gate.*(PASS|FAIL)`,
  // so this phrasing produced zero violations while still matching the hook's grep. It is
  // exploitable rather than cosmetic: `LAST_REVIEW` uses `tail -1`, so a plan preview rendered
  // after a genuine `⛔ Blocked` becomes the last matching line, contains neither `⛔` nor `FAIL`,
  // and `BLOCKED_REASON` is therefore never set — the block silently lifts.
  const plan = basePlan();
  plan.steps[1].why = 'Gate must PASS before merge';
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  assert.ok(rules(result).includes('S1'), 'a Gate.*PASS phrasing must raise S1');
});

test('S1: `⛔ temporarily Blocked` is rejected (regex covers what the literal misses)', () => {
  // `⛔ Blocked` is a literal, but stop-guard greps `⛔.*(Block|Needs revision|Must fix)`, which
  // also fires with words in between — the literal scan alone let this through.
  const plan = basePlan();
  plan.stop_conditions = ['⛔ temporarily Blocked on upstream review'];
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  assert.ok(rules(result).includes('S1'));
});

test('S1 patterns match per line, so `.*` cannot bridge two unrelated fields', () => {
  // False-positive guard for matching over JSON.stringify instead of per string value: "Gate"
  // in one field and "PASS" in another are not a sentinel. A plan blocked for this would be
  // unfixable without renaming ordinary vocabulary.
  const plan = basePlan();
  plan.steps[0].why = 'the Gate agent maps hook entry points';
  plan.steps[1].why = 'confirm the checks PASS on a clean tree';
  const result = runValidate(plan);
  assert.equal(result.exitCode, 0, `expected clean, got ${JSON.stringify(result.output)}`);
});

test('S1 reports one violation per pattern, not per matching line', () => {
  const plan = basePlan();
  plan.steps[0].why = 'Gate must PASS first';
  plan.steps[1].why = 'Gate must PASS again';
  plan.stop_conditions = ['Gate must PASS finally'];
  const result = runValidate(plan);
  const s1 = result.output.violations.filter((v) => v.rule === 'S1');
  assert.equal(s1.length, 1, 'three offending lines, one pattern, one violation');
});

test('object admission.allowlist yields a structured SCHEMA violation, not a TypeError', () => {
  // `new Set({...})` throws `TypeError: object is not iterable`, so the caller parsing
  // {ok:false, violations} received a stack trace on stderr and unparseable stdout instead.
  const context = { ...CONTEXT, admission: { mode: 'deny-by-default', allowlist: { Explore: true } } };
  const result = runValidate(basePlan(), context);
  assert.equal(result.exitCode, 1);
  assert.ok(result.output, 'stdout must still be parseable JSON');
  assert.ok(rules(result).includes('SCHEMA'), 'the bad shape is reported as SCHEMA');
  assert.doesNotMatch(result.stderr || '', /TypeError/, 'no uncaught TypeError');
});

test('string admission.allowlist does not become a per-character allowlist', () => {
  // `new Set("Explore")` yields {E,x,p,l,o,r,e} — fail-closed only by accident. A single-character
  // agent name would be admitted by a string that merely contains that letter.
  const context = { ...CONTEXT, admission: { mode: 'deny-by-default', allowlist: 'Explore' } };
  const result = runValidate(basePlan(), context);
  assert.equal(result.exitCode, 1);
  const ruleset = rules(result);
  assert.ok(ruleset.includes('SCHEMA'), 'the bad shape is reported');
  assert.ok(ruleset.includes('A1'), 'and the plan’s Explore fanout is no longer admitted');
});

test('validate-plan: a pathologically nested plan yields a structured refusal, not a RangeError', () => {
  // `collectStrings` recursed unbounded, so a deeply-nested plan produced an uncaught RangeError —
  // a stack trace on stderr instead of the `{ok:false, violations}` this script guarantees
  // everywhere else. Still fail-closed (non-zero exit), but a caller parsing the structured output
  // sees a malformed response rather than a stated refusal, which is the difference between "the
  // validator said no" and "the validator broke".
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-lint-deep-'));
  tempDirs.push(dir);

  let nested = { leaf: 'x' };
  for (let i = 0; i < 200; i += 1) nested = { n: nested };
  writeFileSync(join(dir, 'plan.json'), JSON.stringify({ ...basePlan(), deep: nested }));

  const contextRaw = JSON.stringify(CONTEXT);
  writeFileSync(join(dir, 'context.json'), contextRaw);
  const digest = createHash('sha256').update(contextRaw, 'utf8').digest('hex');

  const err = (() => {
    try {
      execFileSync(
        'node',
        [
          scriptPath,
          '--plan', join(dir, 'plan.json'),
          '--context', join(dir, 'context.json'),
          '--context-sha256', digest,
        ],
        { encoding: 'utf8' }
      );
      return null;
    } catch (e) {
      return e;
    }
  })();

  assert.ok(err, 'a plan too deep to scan must not validate');
  assert.equal(err.status, 1);
  assert.doesNotMatch(err.stderr.toString(), /RangeError|Maximum call stack/);

  const payload = JSON.parse(err.stdout.toString());
  assert.equal(payload.ok, false);
  assert.ok(
    payload.violations.some((v) => v.rule === 'SCHEMA' && /nesting exceeds/.test(v.message)),
    'the refusal must be reported as a violation — an unscanned subtree cannot be cleared'
  );
});
