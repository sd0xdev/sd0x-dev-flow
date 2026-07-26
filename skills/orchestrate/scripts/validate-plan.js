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
 *       report-only: a MUTATING construct is emitted as kind:proposed-manual (A3),
 *       while a non-mutating kind:main-skill step stays main-skill and is validated
 *       here (A4) but is simply NOT dispatched by the v1 executor — so no main-skill
 *       named here actually runs regardless.
 *       SECURITY BOUNDARY: the planner-supplied `mutating` flag is NOT trusted
 *       as the guard here — a lying `mutating:false` on an actually-mutating
 *       target (e.g. /bug-fix) would pass A3+A4. The report-only guarantee does
 *       NOT rest on capability-blocking the Skill tool: `disallowed-tools: Skill`
 *       is deliberately AVOIDED because it stays active until the next user
 *       message (per Claude Code) and would therefore also block the mandatory
 *       same-turn `/codex-review-doc` handoff, which itself runs via the Skill
 *       tool — the run could never reach its Mergeable/`done` gate. (Omitting
 *       Skill from `allowed-tools`, which we do, is only a pre-approval signal,
 *       not a hard block; that is acceptable because the real backstop is below.)
 *       The primary backstop is run-verify.js's SC-2 pre/post no-change proof:
 *       the baseline is snapshotted BEFORE any dispatch and re-compared after, so
 *       any mutation WITHIN THE MONITORED git-scoped surface (porcelain + tracked/
 *       untracked/ignored content + refs/config/hooks/info-exclude/worktree/stash)
 *       — including one an errant main-skill dispatch somehow caused — surfaces as
 *       fail-closed drift → run marked failed, no report written. This is BEST-EFFORT
 *       fail-closed, NOT an absolute guarantee: out-of-repo writes, node_modules/,
 *       .venv/, build artifacts, and index-hiding (assume-unchanged/skip-worktree)
 *       are documented residuals (see SKILL.md report-only section + admission-
 *       allowlist.json residual_risk); v1 report-only strength rests on admission
 *       curation. When main-skill EXECUTION lands (v2), enabling it REQUIRES
 *       skill_candidates carrying a mutation flag so a mutating main-skill target
 *       is rejected here first, plus a reviewed read-only allowlist.
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
const crypto = require('node:crypto');

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

// Mirrors of the EREs in hooks/stop-guard.sh:551,604 that no literal above can express.
// `⛔ Blocked` / `⛔ Needs revision` / `⛔ Must fix` are already literals, but stop-guard's
// `⛔.*(Block|Needs revision|Must fix)` also fires on `⛔ temporarily Blocked`, and nothing in
// the literal list resembles `Gate.*(PASS|FAIL)` at all. Keep this list in sync with those greps.
const FORBIDDEN_SENTINEL_PATTERNS = [
  { re: /Gate.*(PASS|FAIL)/, label: 'Gate.*(PASS|FAIL)' },
  { re: /⛔.*(Block|Needs revision|Must fix)/, label: '⛔.*(Block|Needs revision|Must fix)' },
  { re: /✅ (All Pass|Mergeable|Ready)/, label: '✅ (All Pass|Mergeable|Ready)' },
];

// Every string reachable in the plan, depth-first — KEYS included.
//
// Keys were skipped on the grounds that they are "schema-controlled and already covered by the
// literal scan over JSON.stringify". Neither half held. Nothing rejects unknown keys, so an author
// can name one anything; and the stringify scan matches only the exact literals, not the ERE
// patterns below. A plan carrying the keys `"Gate must PASS before merge"` and
// `"⛔ pipeline Blocked upstream"` validated `ok: true` while both match stop-guard's greps
// verbatim. Live impact was bounded by the additive per-plane scans downstream, which is why this
// was a P2 rather than a hole — but a sentinel scan that inspects half the document is not a
// sentinel scan.
// Depth bound: a real plan nests a handful of levels, so anything past this is pathological input,
// not a plan. Unbounded recursion turned such input into an uncaught RangeError — a stack trace on
// stderr instead of the `{ok:false, violations}` this file guarantees everywhere else. Still
// fail-closed (a crash is a non-zero exit), but a caller parsing the structured output sees a
// malformed response rather than a stated refusal. Overflowing the bound is itself a violation:
// the offending subtree is never scanned, so passing it would be the fail-OPEN reading.
const MAX_PLAN_DEPTH = 64;

function collectStrings(node, out = [], depth = 0) {
  if (depth > MAX_PLAN_DEPTH) throw new PlanTooDeepError(MAX_PLAN_DEPTH);
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const v of node) collectStrings(v, out, depth + 1);
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      // The key does NOT get `depth + 1`: it lives at this node's level, and charging it a level
      // would let a plan at exactly MAX_PLAN_DEPTH hide a sentinel in a key that never gets read.
      out.push(k);
      collectStrings(v, out, depth + 1);
    }
  }
  return out;
}

class PlanTooDeepError extends Error {
  constructor(limit) {
    super(`plan nesting exceeds ${limit} levels`);
    this.name = 'PlanTooDeepError';
  }
}

function fail(msg) {
  process.stderr.write(`[validate-plan] ${msg}\n`);
  process.exit(1);
}

function readInput(spec, label, expectedSha256) {
  let raw;
  try {
    raw = spec === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(spec, 'utf8');
  } catch (e) {
    fail(`${label} unreadable: ${e.message}`);
  }
  // Integrity binding for the context packet. `plan-context.js --out` writes the packet to
  // `.claude_workflows/`, a surface run-verify.js deliberately excludes from drift detection
  // and the Bash-capable planner can write to. Without re-hashing, a planner could append
  // itself to `admission.allowlist` (defeating A1) or invent a `skill_candidates` entry
  // (defeating A4), return a plan matching its own edit, and validate clean with no drift
  // recorded anywhere. The expected digest travels through the main session in the
  // plan-context summary, which the planner never touches.
  if (expectedSha256) {
    const actual = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    if (actual !== expectedSha256) {
      fail(
        `${label} digest mismatch — expected ${expectedSha256}, got ${actual}. ` +
          'The context packet was modified after assembly; refusing to validate against it.'
      );
    }
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
    else if (a === '--context-sha256') args.contextSha256 = next();
    else fail(`unknown flag: ${a}`);
  }
  if (!args.plan || !args.context) {
    fail('usage: validate-plan.js --plan <path|-> --context <path|-> [--context-sha256 <hex>]');
  }
  if (args.contextSha256 !== undefined && !/^[0-9a-f]{64}$/.test(args.contextSha256)) {
    fail('--context-sha256 must be a 64-character lowercase hex SHA-256 digest');
  }
  // The digest is required UNCONDITIONALLY — stdin included.
  //
  // The exemption that used to sit here rested on "`--context -` is piped in-process from
  // plan-context.js and never lands on a writable surface." That premise does not hold:
  // plan-context.js REQUIRES `--out` and has no stdout-packet branch at all, so it cannot feed a
  // pipe. The only way to reach `--context -` is `cat <a file already at rest under
  // .claude_workflows/>` — the same planner-writable surface the file path is distrusted for, but
  // with integrity checking fully disabled. The error text even advertised the route ("or pipe the
  // packet via `--context -` instead"), so both A1 (deny-by-default admission) and A4
  // (anti-hallucination) fell to a one-character flag change.
  //
  // The sibling settles the design question: run-verify.js requires `--baseline-sha256`
  // unconditionally, `--baseline -` included, citing the same trust chain. A digest that travels a
  // channel the workers never touch is what binds the artifact; where the bytes entered the
  // process is not evidence of anything.
  if (args.contextSha256 === undefined) {
    fail(
      '--context-sha256 is required. Pass the `sha256` field from the plan-context.js --out summary.'
    );
  }
  return args;
}

function validate(plan, context) {
  const violations = [];
  const add = (rule, message, step) => violations.push({ rule, ...(step ? { step } : {}), message });
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  // One violation per S1 pattern, not per matching line — a plan that repeats an offending phrase
  // in ten `why` fields is one defect to fix, and ten copies would bury the other rules' output.
  const reportedPatterns = new Set();

  // Top-level shape guards: a valid-JSON-but-wrong-shape payload (null, array,
  // scalar) must yield a structured SCHEMA violation, not a thrown TypeError from
  // `plan[field]` / `context.budget` below. Fail-closed — return immediately so no
  // later access dereferences a non-object.
  if (!isPlainObject(plan)) {
    add('SCHEMA', 'plan must be a JSON object');
    return violations;
  }
  if (!isPlainObject(context)) {
    add('SCHEMA', 'context must be a JSON object');
    return violations;
  }

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
  // Non-object step entries (null, arrays, scalars) can't expose id/kind/depends_on.
  // Report each as SCHEMA and exclude them from the field-accessing loops below, so a
  // malformed entry produces structured violations instead of a TypeError on step.id.
  // `steps` (original length) is still used for the budget max_plan_steps count.
  const objectSteps = [];
  for (const step of steps) {
    if (isPlainObject(step)) objectSteps.push(step);
    else add('SCHEMA', `each step must be a JSON object (got ${JSON.stringify(step)})`);
  }
  const budget = context.budget || {};
  // Array-guard the allowlist, matching the isPlainObject hardening its neighbours already got.
  // `new Set(obj)` on `{"allowlist":{"Explore":true}}` throws an uncaught
  // `TypeError: object is not iterable`, so a consumer parsing `{ok:false, violations}` gets a
  // stack trace on stderr instead of structured output. A STRING allowlist is worse than a crash:
  // `new Set("Explore")` yields the per-CHARACTER set {E,x,p,l,o,r,e}, which fails closed only by
  // accident (no single-char agent name exists today). Both now degrade to an empty allowlist —
  // admitting nothing — plus an explicit SCHEMA violation naming the bad shape.
  const rawAllowlist = (context.admission || {}).allowlist;
  if (rawAllowlist !== undefined && rawAllowlist !== null && !Array.isArray(rawAllowlist)) {
    add('SCHEMA', `admission.allowlist must be an array (got ${typeof rawAllowlist}) — treating it as empty`);
  }
  const allowset = new Set(Array.isArray(rawAllowlist) ? rawAllowlist : []);
  // A4 candidate set — fail-closed: a context without skill_candidates cannot
  // prove a main-skill target is real. Skip non-object elements (null / scalar)
  // rather than dereferencing `.command` on them — a malformed candidate must
  // yield the structured {ok:false, violations} rejection every other bad-input
  // path now produces, not an uncaught TypeError with a stack trace. Also require
  // a STRING `command`: an object lacking one would `.map` to `undefined`, and a
  // Set holding `undefined` makes `has(undefined) === true` — so a main-skill step
  // with a missing/undefined target would pass A4 (anti-hallucination bypass). A
  // dropped garbage candidate simply isn't a valid target, so A4 stays fail-closed.
  const skillCommands = Array.isArray(context.skill_candidates)
    ? new Set(
        context.skill_candidates
          .filter((s) => isPlainObject(s) && typeof s.command === 'string')
          .map((s) => s.command),
      )
    : null;
  const gates = Array.isArray(plan.required_gates) ? plan.required_gates : [];

  const seenIds = new Set();
  for (const step of objectSteps) {
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
      const mr = step.converge.max_rounds;
      // A COUNT of convergence rounds, so `typeof === 'number'` was the wrong test: it admits 0,
      // -1 and 0.5. An executor looping `round < max_rounds` runs zero rounds for 0 or -1 —
      // convergence silently skipped while the plan still validates — and a fractional budget is
      // meaningless in either direction. Require a positive integer, then apply the ceiling.
      if (!Number.isInteger(mr) || mr < 1) {
        add('B1', `converge.max_rounds must be an integer >= 1 (got ${JSON.stringify(mr)})`, id);
      } else if (typeof budget.max_waves === 'number' && mr > budget.max_waves) {
        add('B1', `converge.max_rounds ${mr} exceeds budget max_waves ${budget.max_waves}`, id);
      }
    }
  }

  for (const step of objectSteps) {
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
  for (const step of objectSteps) {
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

  const mutatingSteps = objectSteps.filter((s) => s.mutating === true);
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
    for (const step of objectSteps) {
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

  // Regex-shaped forbidden sentinels. The literal list above enumerates EXACT sentinel strings,
  // but stop-guard.sh does not match literals — `hooks/stop-guard.sh:551,604` grep
  // `Gate.*(PASS|FAIL)` and `⛔.*(Block|Needs revision|Must fix)`, which accept text no literal
  // covers. Verified: `why: "Gate must PASS before merge"` produces zero S1 hits yet matches
  // stop-guard's ERE. That gap is exploitable because `LAST_REVIEW` takes `tail -1`: a plan
  // preview rendered AFTER a genuine `⛔ Blocked` becomes the last matching line, and since it
  // contains neither `⛔` nor `FAIL`, `BLOCKED_REASON` is never set and the block silently lifts.
  // Matched per STRING VALUE and per line — mirroring grep's line-oriented semantics — rather than
  // over the single-line JSON.stringify, so `.*` cannot bridge two unrelated fields into a match.
  let planStrings;
  try {
    planStrings = collectStrings(plan);
  } catch (e) {
    if (!(e instanceof PlanTooDeepError)) throw e;
    // Structured refusal, not a stack trace. The unscanned subtree cannot be cleared, so this is
    // a violation rather than a skipped check.
    add('SCHEMA', `${e.message} — refusing to scan; flatten the plan and re-validate`);
    return violations;
  }
  for (const value of planStrings) {
    for (const line of value.split('\n')) {
      for (const { re, label } of FORBIDDEN_SENTINEL_PATTERNS) {
        if (re.test(line) && !reportedPatterns.has(label)) {
          reportedPatterns.add(label);
          add('S1', `plan text matches hook-parsed sentinel pattern /${label}/ ("${line.trim().slice(0, 80)}") — describe gates by name instead`);
        }
      }
    }
  }

  return violations;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = readInput(args.plan, 'plan');
  const context = readInput(args.context, 'context', args.contextSha256);
  const violations = validate(plan, context);
  if (violations.length) {
    process.stdout.write(`${JSON.stringify({ ok: false, violations }, null, 2)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
}

main();
