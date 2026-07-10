const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../skills/orchestrate/scripts/validate-plan.js');
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

function runValidate(plan, context = CONTEXT) {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-lint-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  writeFileSync(join(dir, 'context.json'), JSON.stringify(context));
  try {
    const stdout = execFileSync(
      'node',
      [scriptPath, '--plan', join(dir, 'plan.json'), '--context', join(dir, 'context.json')],
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

test('validate-plan B1: non-numeric converge.max_rounds → rejected (no silent coercion)', () => {
  const plan = basePlan();
  plan.steps[0].converge = { max_rounds: 'abc', until: 'no new findings' };
  const result = runValidate(plan);
  assert.equal(result.exitCode, 1);
  assert.match(result.output.violations.find((v) => v.rule === 'B1').message, /must be a number/);
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
  writeFileSync(join(dir, 'context.json'), JSON.stringify(CONTEXT));
  writeFileSync(join(dir, 'broken.json'), '{not json');
  const missing = (() => {
    try {
      execFileSync('node', [scriptPath, '--plan', join(dir, 'absent.json'), '--context', join(dir, 'context.json')], { encoding: 'utf8' });
      return null;
    } catch (err) {
      return err;
    }
  })();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr.toString(), /plan unreadable/);
  const malformed = (() => {
    try {
      execFileSync('node', [scriptPath, '--plan', join(dir, 'broken.json'), '--context', join(dir, 'context.json')], { encoding: 'utf8' });
      return null;
    } catch (err) {
      return err;
    }
  })();
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr.toString(), /not valid JSON/);
});
