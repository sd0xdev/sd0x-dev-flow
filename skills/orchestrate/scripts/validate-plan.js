#!/usr/bin/env node
/**
 * validate-plan.js — v1 admission controller for /orchestrate plans.
 *
 * Lints a planner-produced plan JSON against the plan-context output. All
 * rules are fail-closed: any violation → exit 1 with {ok:false, violations[]}
 * listing every broken rule (not just the first). Pass → exit 0 {ok:true}.
 *
 * Rules (tech-spec §3.3 T2):
 *   A1  kind:fanout target must be in admission.allowlist (deny-by-default)
 *   A2  kind:fanout with mutating:true → reject (contradictory declaration)
 *   A3  any mutating:true step must have kind:proposed-manual (v1 report-only)
 *   A4  kind:main-skill target must exist in plan-context skill_candidates
 *       (anti-hallucination — planner may only pick real skills). v1 is
 *       report-only: main-skill steps are advisory/non-executing, so a
 *       mutating skill named here cannot mutate the repo — and any mutation it
 *       somehow caused is still caught by run-verify.js's no-change proof. When
 *       main-skill execution lands (v2), skill_candidates must carry a mutation
 *       flag and a mutating main-skill target must be rejected here.
 *   G1  mutating steps present → required_gates must cover them
 *       (mutation_class "doc" → doc-review; anything else, including the
 *       conservative default "code", → code-review + precommit)
 *   G2  required_gates must include doc-review (v1's report Write is always a doc mutation)
 *   O1  every step must have a non-empty why (observability, Signal 6)
 *   B1  steps.length ≤ max_plan_steps; per parallel_group size ≤ max_workers;
 *       converge.max_rounds ≤ max_waves (non-numeric max_rounds → reject)
 *   S1  serialized plan must not contain hook-parsed sentinel strings
 *   SCHEMA  structural integrity: intent/done_definition non-empty, steps is
 *       an array, known kind, step ids present and unique, depends_on is an
 *       array whose references resolve to existing ids and form a DAG (no cycle)
 *
 * Usage:
 *   node skills/orchestrate/scripts/validate-plan.js --plan <path|-> --context <path|->
 */

const fs = require('fs');

const VALID_KINDS = new Set(['fanout', 'main-skill', 'verify', 'gate', 'proposed-manual']);
// Forbidden hook-parsed sentinels — literal substring match on the serialized
// plan. Kept aligned with the strings hooks/stop-guard.sh and
// hooks/post-tool-review-state.sh act on, so a plan that recites a gate verdict
// (in a why/done_definition later surfaced in a preview/summary) cannot poison
// the safety-plane gate parsing this feature is designed to isolate from.
// Substring match is literal: '✅ Ready' does NOT cover '✅ Plan Ready' (after
// '✅ ' comes "Plan", not "Ready"), and '⛔ Blocked' does NOT cover
// '⛔ Plan Blocked' — the plan-namespace sentinels are therefore listed
// explicitly, and the header triggers ('## Overall:', '## Document Review',
// '## Plan Review') are blocked so a recited verdict body cannot attach to them.
const FORBIDDEN_SENTINELS = [
  '## Gate:', // ## Gate: ✅ / ⛔
  '## Overall:', // ## Overall: ✅ PASS / ⛔ FAIL / ❌ FAIL (precommit)
  '## Document Review', // doc-review parser trigger
  '## Plan Review', // plan-review parser trigger
  '✅ Ready',
  '✅ Mergeable',
  '✅ All Pass',
  '✅ Plan Ready',
  '⛔ Blocked',
  '⛔ Needs revision',
  '⛔ Must fix',
  '⛔ Plan Blocked',
];

function fail(msg) {
  process.stderr.write(`[validate-plan] ${msg}\n`);
  process.exit(1);
}

function readInput(spec, label) {
  let raw;
  try {
    raw = spec === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(spec, 'utf8');
  } catch (e) {
    fail(`${label} unreadable: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`${label} is not valid JSON: ${e.message}`);
  }
  return null;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) fail(`flag ${a} requires a value`);
      return argv[i];
    };
    if (a === '--plan') args.plan = next();
    else if (a === '--context') args.context = next();
    else fail(`unknown flag: ${a}`);
  }
  if (!args.plan || !args.context) fail('usage: validate-plan.js --plan <path|-> --context <path|->');
  return args;
}

function validate(plan, context) {
  const violations = [];
  const add = (rule, message, step) => violations.push({ rule, ...(step ? { step } : {}), message });

  for (const field of ['intent', 'done_definition']) {
    if (typeof plan[field] !== 'string' || plan[field].trim() === '') {
      add('SCHEMA', `plan.${field} is required and must be a non-empty string`);
    }
  }
  const steps = Array.isArray(plan.steps) ? plan.steps : null;
  if (!steps) {
    add('SCHEMA', 'plan.steps must be an array');
    return violations;
  }
  const budget = context.budget || {};
  const allowset = new Set(((context.admission || {}).allowlist) || []);
  // A4 candidate set — fail-closed: a context without skill_candidates cannot
  // prove a main-skill target is real.
  const skillCommands = Array.isArray(context.skill_candidates)
    ? new Set(context.skill_candidates.map((s) => s.command))
    : null;
  const gates = Array.isArray(plan.required_gates) ? plan.required_gates : [];

  const seenIds = new Set();
  for (const step of steps) {
    const id = typeof step.id === 'string' && step.id.trim() !== '' ? step.id : '(missing id)';
    if (id === '(missing id)') {
      // A step without a stable id cannot be tracked in run-state steps_status.
      add('SCHEMA', 'step.id is required and must be a non-empty string', id);
    } else if (seenIds.has(id)) {
      add('SCHEMA', `duplicate step id "${id}" — ids must be unique (plan-schema)`, id);
    }
    seenIds.add(id);
    if (!VALID_KINDS.has(step.kind)) {
      add('SCHEMA', `unknown kind "${step.kind}"`, id);
      continue;
    }
    if (step.kind === 'fanout' && !allowset.has(step.target)) {
      add('A1', `fanout target "${step.target}" not in admission allowlist (deny-by-default)`, id);
    }
    if (step.kind === 'fanout' && step.mutating === true) {
      add('A2', 'fanout step declares mutating:true — contradictory', id);
    }
    if (step.kind === 'main-skill') {
      if (!skillCommands) {
        add('A4', 'context.skill_candidates missing — cannot validate main-skill target (fail-closed)', id);
      } else if (!skillCommands.has(step.target)) {
        add('A4', `main-skill target "${step.target}" not found in plan-context skill candidates`, id);
      }
    }
    if (step.mutating === true && step.kind !== 'proposed-manual') {
      add('A3', `mutating step must be kind:proposed-manual in v1 (got "${step.kind}")`, id);
    }
    if (typeof step.why !== 'string' || step.why.trim() === '') {
      add('O1', 'step.why is required and must be non-empty (Signal 6)', id);
    }
    if (step.converge) {
      if (typeof step.converge.max_rounds !== 'number') {
        add('B1', `converge.max_rounds must be a number (got ${JSON.stringify(step.converge.max_rounds)})`, id);
      } else if (typeof budget.max_waves === 'number' && step.converge.max_rounds > budget.max_waves) {
        add('B1', `converge.max_rounds ${step.converge.max_rounds} exceeds budget max_waves ${budget.max_waves}`, id);
      }
    }
  }

  for (const step of steps) {
    if (step.depends_on === undefined) continue;
    if (!Array.isArray(step.depends_on)) {
      add('SCHEMA', `depends_on must be an array (got ${JSON.stringify(step.depends_on)})`, step.id || '(missing id)');
      continue;
    }
    for (const dep of step.depends_on) {
      if (!seenIds.has(dep)) {
        add('SCHEMA', `depends_on references unknown step id "${dep}"`, step.id || '(missing id)');
      }
    }
  }

  // depends_on must form a DAG — execution-policy.md mandates topological order,
  // so a cycle (s1→s2→s1) is an unsatisfiable plan. Kahn's algorithm is
  // iterative (no recursion), so an adversarial deep chain cannot exhaust the
  // call stack before the B1 size cap is evaluated. Only edges to resolvable
  // ids are followed (dangling refs are already reported as SCHEMA above);
  // duplicate edges are collapsed so indegree accounting stays exact, and a
  // self-edge (s1→s1) never reaches indegree 0 → reported as a cycle.
  // Build the graph from the first step per unique id: a duplicate id is already
  // a SCHEMA violation, and double-counting its edges could distort indegree
  // bookkeeping enough to mask a real cycle. Deduping up front keeps the DAG
  // check exact and independent of the duplicate-id rule.
  const firstById = new Map();
  for (const step of steps) {
    if (typeof step.id !== 'string' || step.id.trim() === '') continue;
    if (!firstById.has(step.id)) firstById.set(step.id, step);
  }
  const dependents = new Map([...firstById.keys()].map((id) => [id, []])); // dep id → ids that require it
  const indegree = new Map([...firstById.keys()].map((id) => [id, 0]));
  for (const [id, step] of firstById) {
    const deps = Array.isArray(step.depends_on) ? step.depends_on.filter((d) => indegree.has(d)) : [];
    for (const dep of new Set(deps)) {
      dependents.get(dep).push(id);
      indegree.set(id, indegree.get(id) + 1);
    }
  }
  const ready = [...indegree.keys()].filter((id) => indegree.get(id) === 0);
  let resolvedCount = 0;
  while (ready.length) {
    const id = ready.pop();
    resolvedCount += 1;
    for (const dependent of dependents.get(id)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) ready.push(dependent);
    }
  }
  // A DAG resolves every unique node; a shortfall means a cycle remains.
  if (resolvedCount < indegree.size) {
    add('SCHEMA', 'depends_on forms a cycle — plan must be a DAG (topological execution required)');
  }

  const mutatingSteps = steps.filter((s) => s.mutating === true);
  // Conservative default: an unclassified mutation is treated as code (G1).
  const needsCodeGates = mutatingSteps.some((s) => (s.mutation_class || 'code') !== 'doc');
  const needsDocGateFromMutation = mutatingSteps.some((s) => s.mutation_class === 'doc');
  if (needsCodeGates && !(gates.includes('code-review') && gates.includes('precommit'))) {
    add('G1', 'plan contains code-class mutating steps but required_gates lacks code-review + precommit');
  }
  if (needsDocGateFromMutation && !gates.includes('doc-review')) {
    add('G1', 'plan contains doc-class mutating steps but required_gates lacks doc-review');
  }
  if (!gates.includes('doc-review')) {
    add('G2', 'required_gates must include doc-review (v1 report Write is a doc mutation)');
  }

  if (typeof budget.max_plan_steps === 'number' && steps.length > budget.max_plan_steps) {
    add('B1', `plan has ${steps.length} steps, exceeds budget max_plan_steps ${budget.max_plan_steps}`);
  }
  if (typeof budget.max_workers === 'number') {
    const groups = new Map();
    for (const step of steps) {
      if (step.kind !== 'fanout' || !step.parallel_group) continue;
      groups.set(step.parallel_group, (groups.get(step.parallel_group) || 0) + 1);
    }
    for (const [group, size] of groups) {
      if (size > budget.max_workers) {
        add('B1', `parallel_group "${group}" has ${size} fanout steps, exceeds budget max_workers ${budget.max_workers}`);
      }
    }
  }

  const serialized = JSON.stringify(plan);
  for (const sentinel of FORBIDDEN_SENTINELS) {
    if (serialized.includes(sentinel)) {
      add('S1', `plan text contains forbidden hook-parsed sentinel "${sentinel}" — describe gates by name instead`);
    }
  }

  return violations;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = readInput(args.plan, 'plan');
  const context = readInput(args.context, 'context');
  const violations = validate(plan, context);
  if (violations.length) {
    process.stdout.write(`${JSON.stringify({ ok: false, violations }, null, 2)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
}

main();
