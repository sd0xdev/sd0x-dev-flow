// Cross-file consistency for rules/auto-loop.md § Stall Detection.
//
// The feature is split across a behaviour-layer rule and a hook that implements part of it, and
// the two agree only by convention: the rule states a threshold, a buffer bound and a closed set
// of classes, and the hook hardcodes all three. Nothing at runtime notices when one moves. That
// is the same failure `max-rounds-default-consistency.test.js` exists for, one layer up.
//
// See rules/auto-loop.md § Stall Detection and § Cap Diagnostic Protocol.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const autoLoop = read('rules/auto-loop.md');
const hook = read('hooks/post-tool-review-state.sh');

// --- Tier caps ------------------------------------------------------------------------------

// The behaviour-layer caps. Loose by design: § Stall Detection is what catches a stuck loop, so
// the cap is left doing its honest job as a runaway backstop.
const EXPECTED_CAPS = { fast: 6, standard: 15, thorough: 30 };

test('the tier table states the expected round caps', () => {
  for (const [tier, cap] of Object.entries(EXPECTED_CAPS)) {
    const row = autoLoop.split('\n').find((l) => l.startsWith(`| \`${tier}\``));
    assert.ok(row, `no tier row for ${tier}`);
    const cells = row.split('|').map((c) => c.trim());
    assert.equal(cells[cells.length - 2], String(cap), `${tier} round cap`);
  }
});

test('standard stays above the strategic checkpoint', () => {
  // The dead angle this cap raise closed. `AUTO_LOOP_CHECKPOINT_ROUNDS` fires at round 10; while
  // the default tier capped at 5 the checkpoint was live code no default-tier loop could reach
  // *without running past its own cap* — possible in warn mode, since nothing clamps current_round
  // to max_rounds, but not a path to design around.
  const ckpt = Number(/AUTO_LOOP_CHECKPOINT_ROUNDS:-(\d+)/.exec(hook)[1]);
  assert.ok(
    EXPECTED_CAPS.standard > ckpt,
    `standard cap ${EXPECTED_CAPS.standard} must exceed the round-${ckpt} checkpoint`
  );
});

test('codex-code-review references the tier table instead of restating the caps', () => {
  // They were restated in skills/codex-code-review/SKILL.md and drifted. A second copy is not a
  // convenience — it is the thing that goes stale silently. This pins that one copy's removal; it
  // is NOT a claim that the numbers appear nowhere else (prose in the rule, the READMEs and the
  // implementation notes all name them, and the READMEs have their own oracle in
  // test/scripts/generate-readme-catalog.test.js).
  const skill = read('skills/codex-code-review/SKILL.md');
  assert.ok(
    !/`fast`\s*\d+,\s*`standard`\s*\d+/.test(skill),
    'codex-code-review must reference § Tiers, not restate the numbers'
  );
});

// --- Stall detection contract ---------------------------------------------------------------

test('the rule documents the stall signal, its threshold and its reset condition', () => {
  assert.match(autoLoop, /^## Stall Detection$/m);
  assert.match(autoLoop, /\[LOOP_STALL\] streak=n threshold=t round=r/);
  assert.match(autoLoop, /persisted \+ new >= findings/, 'the ledger-bearing condition');
  assert.match(autoLoop, /absence is not a signal/i, 'a blind round holds the streak');
  assert.match(autoLoop, /fires \*\*once per streak\*\*/, 'edge, not level');
});

test('the hook default threshold is the 3 the rule states', () => {
  const fromHook = Number(/AUTO_LOOP_STALL_ROUNDS:-(\d+)/.exec(hook)[1]);
  assert.equal(fromHook, 3);
  // The rule states it as prose, so the pin has to read the prose. Both must move together.
  assert.match(autoLoop, /`AUTO_LOOP_STALL_ROUNDS`, default \*\*3\*\*/);
});

test('the stall-memory buffer bound agrees across the rule and the hook', () => {
  assert.match(autoLoop, /most recent 3\*\* \(FIFO\)/);
  assert.match(hook, /if length > 3 then \.\[-3:\] else \. end/,
    'the FIFO cap in _upsert_stall_memory');
});

test('the hook validates exactly the six classes the rule table defines', () => {
  const declared = /^STALL_CLASSES="([^"]+)"/m.exec(hook);
  assert.ok(declared, 'the hook must declare its closed class set in one place');
  const fromHook = declared[1].trim().split(/\s+/).sort();

  const section = autoLoop.slice(autoLoop.indexOf('| Class | Signals |'));
  const fromRule = [...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]).sort();

  assert.equal(fromRule.length, 6, 'the class table should have six rows');
  assert.deepEqual(fromHook, fromRule,
    'a class added to the table but not the hook is silently rejected at ingest, and vice versa');
});

// --- The /refactor adjustment ----------------------------------------------------------------

test('/refactor is offered for exactly two classes, and constrained where it is', () => {
  const rows = [...autoLoop.matchAll(/^\| `([A-Z_]+)` \| [^|]+\| ([^|]+)\|/gm)];
  const withRefactor = rows.filter((m) => m[2].includes('/refactor')).map((m) => m[1]);
  assert.deepEqual(withRefactor.sort(), ['ATTENTION_DIFFUSION', 'DOC_TOO_LONG']);

  // The four that must NOT offer it, each for a reason stated in the rule: two exit rather than
  // adjust, one needs a measurement, one needs the loop to stop.
  for (const cls of ['ARCHITECTURE', 'REQUIREMENT_AMBIGUITY', 'UNVERIFIED_CLAIM', 'TIER_MISMATCH']) {
    assert.ok(!withRefactor.includes(cls), `${cls} must not offer /refactor`);
  }

  assert.match(autoLoop, /`--target <paths>` always, never `--auto`/);
  assert.match(autoLoop, /Anchor Register #6/, 'the refactor re-opens the code gate');
  assert.match(autoLoop, /is \*\*not\*\* this loop's precommit gate/);
  assert.match(autoLoop, /Excluded for security and data-integrity changes/);
});

// --- The anti-loop budget --------------------------------------------------------------------

test('the two triggers carry separate budgets, and the stall budget matches the memory bound', () => {
  // A stall may recur where a cap hit may not, and the number of times it may recur is the same 3
  // the memory holds — when the replay is full of failed adjustments, a fourth is not the answer.
  const table = autoLoop.slice(autoLoop.indexOf('| Trigger | Budget |'));
  assert.match(table, /\| Round cap \| \*\*1\*\* diagnosis per change \|/);
  assert.match(table, /\| `\[LOOP_STALL\]` \| \*\*3\*\* per change/);
});
