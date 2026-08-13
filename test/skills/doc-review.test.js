'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const { PROFILES } = require('../../scripts/resolve-review-profile');

const repoRoot = resolve(__dirname, '../..');
const skillPath = resolve(repoRoot, 'skills/doc-review/SKILL.md');
const SKILL = readFileSync(skillPath, 'utf8');

function splitFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  return { frontmatter: match ? match[1] : '', body: match ? content.slice(match[0].length) : content };
}

/** Every `allowed-tools` entry, as written. */
function allowedTools(content) {
  const line = /^allowed-tools:\s*(.+)$/m.exec(splitFrontmatter(content).frontmatter);
  if (!line) return [];
  return line[1].split(',').map((t) => t.trim()).filter(Boolean);
}

/** The fenced shell blocks — the commands the skill actually instructs, not the prose about them. */
function shellBlocks(body) {
  const blocks = [];
  const fence = /^ {0,3}```(?:bash|sh|shell|zsh)\s*$/;
  let current = null;
  for (const line of body.split('\n')) {
    if (current === null) {
      if (fence.test(line)) current = [];
      continue;
    }
    if (/^ {0,3}```/.test(line)) { blocks.push(current.join('\n')); current = null; continue; }
    current.push(line);
  }
  return blocks;
}

/**
 * The binary each instructed command runs. A command the skill tells the model to run needs a
 * matching grant, or the model is instructed to do something the skill's own permissions refuse —
 * the pairing `test/skills/scan-error-gate.test.js` enforces for the source-set consumers.
 */
function instructedBinaries(content) {
  const binaries = new Set();
  for (const block of shellBlocks(splitFrontmatter(content).body)) {
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const first = line.split(/\s+/)[0];
      if (!/^[a-z][a-z0-9_.-]*$/i.test(first)) continue;
      binaries.add(first);
    }
  }
  return [...binaries];
}

function ungrantedBinaries(content) {
  const grants = allowedTools(content)
    .map((t) => /^Bash\(([^:)\s]+)/.exec(t))
    .filter(Boolean)
    .map((m) => m[1]);
  return instructedBinaries(content).filter((bin) => !grants.includes(bin));
}

/** The scripts the body tells the model to run, as repo-relative paths. */
function instructedScripts(content) {
  const found = new Set();
  for (const block of shellBlocks(splitFrontmatter(content).body)) {
    for (const m of block.matchAll(/\bnode\s+((?:scripts|skills)\/[\w./-]+\.js)/g)) found.add(m[1]);
  }
  return [...found];
}

/** The profile names the `## Review Profiles` table declares, in table order. */
function tabledProfiles(content) {
  const section = /\n## Review Profiles\n([\s\S]*?)(?=\n## )/.exec(content);
  if (!section) return [];
  const names = [];
  for (const line of section[1].split('\n')) {
    const cell = /^\|\s*`([a-z-]+)`\s*\|/.exec(line);
    if (cell) names.push(cell[1]);
  }
  return names;
}

// ── Frontmatter and the instruction/permission pairing ─────────────────────

test('skills/doc-review/SKILL.md declares its name and a non-empty description', () => {
  const { frontmatter } = splitFrontmatter(SKILL);

  assert.match(frontmatter, /^name:\s*doc-review\s*$/m);
  assert.match(frontmatter, /^description:\s*".+"\s*$/m,
    'the description is the dispatcher discovery interface — an empty one hides the skill');
});

test('node is the only instructed binary left ungranted, and that is deliberate', () => {
  assert.deepEqual(ungrantedBinaries(SKILL), ['node'],
    'git must stay granted; a second ungranted binary is an unintended prompt mid-review');
});

test('the pairing check fails on an ungranted binary and passes on a granted one', () => {
  const ungranted = [
    '---', 'name: x', 'allowed-tools: Bash(git:*), Read', '---', '',
    '```bash', 'python3 scripts/resolve-review-profile.py', '```', '',
  ].join('\n');
  const granted = ungranted.replace('Bash(git:*)', 'Bash(python3:*), Bash(git:*)');

  assert.deepEqual(ungrantedBinaries(ungranted), ['python3'],
    'without a negative control this check is green on the day it lands and never again');
  assert.deepEqual(ungrantedBinaries(granted), []);
});

test('Bash(node:*) is withheld, so Steps 2-3 ask for permission when they run', () => {
  assert.ok(!allowedTools(SKILL).includes('Bash(node:*)'),
    'pre-approval is not needed to run node — omitting it only removes the silent grant');
  assert.ok(instructedBinaries(SKILL).includes('node'),
    'the omission is only meaningful while the workflow still instructs node commands');
  assert.match(SKILL, /`allowed-tools` is pre-approval, not a capability/,
    'an unexplained missing grant reads as an oversight and gets "fixed" back in');
});

test('every script the workflow instructs exists in this checkout', () => {
  const scripts = instructedScripts(SKILL);
  const missing = scripts.filter((rel) => !existsSync(resolve(repoRoot, rel)));

  assert.deepEqual(missing, [], 'a workflow step naming a script that does not exist cannot run');
  assert.ok(scripts.includes('scripts/check-doc-links.js'));
  assert.ok(scripts.includes('scripts/resolve-review-profile.js'));
});

// ── Workflow ordering ──────────────────────────────────────────────────────

test('deterministic checks are instructed before the Codex dispatch, not after', () => {
  const links = SKILL.indexOf('node scripts/check-doc-links.js');
  const resolver = SKILL.indexOf('node scripts/resolve-review-profile.js');
  const dispatch = SKILL.indexOf('### Step 4');

  assert.ok(links > 0 && resolver > 0 && dispatch > 0, 'all three steps must be present');
  assert.ok(links < resolver, 'link facts feed the resolver plan and the prompt');
  assert.ok(resolver < dispatch,
    'the profile is resolved before the prompt is built — a shallow prompt for a change that did not '
    + 'earn one is never assembled');
});

test('the profile is stated to narrow reading, never whether review runs', () => {
  assert.match(SKILL, /narrows what the reviewer \*\*reads\*\*, never \*\*whether\*\* review runs/,
    'Anchor Register #6: tier and profile decide depth only');
  assert.match(SKILL, /no resolver\s+outcome auto-passes anything/,
    'a resolver that could auto-pass would be a gate this feature promised not to add');
});

// ── The plan, not the file, is the review unit ─────────────────────────────

test('the review unit is the plan: no step dispatches per file', () => {
  assert.match(SKILL, /All changed `\.md` in one change are one review plan/);
  assert.match(SKILL, /One Dispatch Per Batch/,
    'the dispatch unit is the batch the resolver produced');
  assert.doesNotMatch(SKILL, /per updated file|file-by-file review|one dispatch per file/i,
    'per-file dispatch is exactly what this workflow replaced');
});

test('the target set may not be narrowed, and an over-budget plan splits loudly', () => {
  assert.match(SKILL, /Never narrow a multi-file change to one file, and never ask the user to pick one/);
  assert.match(SKILL, /Never claim one dispatch you did not make, and never drop a file to fit/,
    'silently dropping a file to fit the budget reads as coverage it never had');
});

test('the link checker is described as advisory, not as a gate', () => {
  assert.match(SKILL, /\*\*Advisory\s+input, not a gate\*\*/);
  assert.match(SKILL, /always exits 0/,
    'the exit code is the whole claim — check-doc-links.js returns 0 whatever it finds');
});

// ── The profile table is the resolver's table ──────────────────────────────

test('the profile table lists exactly the profiles the resolver can produce', () => {
  const tabled = tabledProfiles(SKILL);

  assert.ok(tabled.length > 0, 'the ## Review Profiles table must be parseable');
  assert.deepEqual([...tabled].sort(), [...PROFILES].sort(),
    'a profile the resolver emits but the skill does not document is one nobody can act on');
});

test('the table parser reads the table, not any backticked name in the file', () => {
  const decoy = SKILL.replace('## Review Profiles', '## Review Profiles Elsewhere');

  assert.deepEqual(tabledProfiles(decoy), [],
    'without this the assertion above would pass on prose mentioning the profile names');
});

test('record-diff is documented as carrying no code-alignment obligation', () => {
  const section = /\n## Review Profiles\n([\s\S]*?)(?=\n## )/.exec(SKILL)[1];
  const row = section.split('\n').find((l) => l.startsWith('| `record-diff`'));

  assert.ok(row, 'the record-diff row must exist');
  assert.match(row, /No code-alignment obligation/,
    'exempting time-point records from code alignment is the cost cut this feature is for');
});

// ── Sub-threshold handling stays intact ────────────────────────────────────

test('deferred doc findings keep the reporting-convention tag and field order', () => {
  assert.match(SKILL, /\[NIT_DEFERRED\] file:line \| issue \| reason: sub-threshold-doc \| <ISO8601>/,
    'the tag and field order are the greppable convention (hook-lightweighting: nothing parses '
    + 'it) — reworded, every report/transcript grep that relies on the shape breaks');
  assert.match(SKILL, /Do not batch-fix 🟡\/⚪ and re-review/,
    'a re-review of non-blocking findings is the round the gate already said was unnecessary');
});

test('the skill never says an empty failures list settles links on its own', () => {
  const content = SKILL;

  // The checker is a scanner, not a parser. A step telling the agent the question is settled on
  // `failures` alone contradicts the prompt it then builds, and the agent reads the step first.
  const claim = /empty\s+`?failures`?[^.]*\b(settled|resolves|resolve)\b/i;
  assert.doesNotMatch(content, claim,
    'an unqualified "empty failures settles it" instruction is the failure this test exists to catch');
  assert.match(content, /`unresolved`/,
    'the positive control: the coverage field has to be named somewhere for the pair to be readable');
  assert.match(content, /only\s+alongside\s+`unresolved: 0`/,
    'and the pairing has to be stated, not merely implied by mentioning the field');
});

test('the Doc Sync contract is one dispatch everywhere — no surface says per-file any more', () => {
  const surfaces = [
    'rules/auto-loop.md',
    'skills/feature-dev/SKILL.md',
    'skills/update-docs/SKILL.md',
    'skills/doc-review/SKILL.md',
    'skills/create-request/SKILL.md',
  ];
  for (const rel of surfaces) {
    const text = readFileSync(resolve(repoRoot, rel), 'utf8');
    assert.ok(!/per updated file/.test(text), `${rel} must not carry the per-file dispatch sentence`);
  }
  // Both directions: the replacement wording actually stands where the old sentence lived.
  const autoLoop = readFileSync(resolve(repoRoot, 'rules/auto-loop.md'), 'utf8');
  assert.match(autoLoop, /review them all in \*\*one\*\* `\/codex-review-doc` dispatch/);
  assert.match(autoLoop, /resolve-review-profile\.js/, 'depth and batching are named as the resolver\u2019s');
  const featureDev = readFileSync(resolve(repoRoot, 'skills/feature-dev/SKILL.md'), 'utf8');
  assert.match(featureDev, /ONE dispatch/, 'feature-dev routes Doc Sync through the same single dispatch');
});

test('the implementation record exists and reports the r1 baseline the counters actually hold', () => {
  const implPath = resolve(repoRoot, 'docs/features/doc-review-phasing/4-implementation.md');
  assert.ok(existsSync(implPath), '4-implementation.md is the record this feature promised');
  const impl = readFileSync(implPath, 'utf8');
  assert.match(impl, /## 1\. What shipped/, 'the record says what shipped');
  // The baseline is stated against fields doc_iteration_history holds — cumulative, not per-cycle.
  assert.match(impl, /`dispatches`/);
  assert.match(impl, /`verdicts`/);
  assert.match(impl, /Dispatch-to-verdict loss/, 'the derived loss figure is the measurement r3 promised');
  assert.match(impl, /doc_iteration_history/);
  // A frozen point-in-time record, so its figures are assertable: wrong numbers here would be a
  // false record, not drift — 18 dispatches, 2 verdicts, 16 lost, 89%.
  assert.match(impl, /\| `dispatches` \| 18 \|/);
  assert.match(impl, /\| `verdicts` \| 2 /);
  assert.match(impl, /16 of 18 dispatches produced no verdict/);
  assert.match(impl, /— 89%/);
  // And the measurement precedes the § 5 machinery it justifies, as the AC orders them.
  const measured = impl.indexOf('## 2. Measurement');
  const proposed = impl.indexOf('## 5.');
  assert.ok(measured > -1, 'the measurement section exists under its own heading');
  assert.ok(proposed === -1 || measured < proposed, 'the baseline is reported before § 5 proposes anything');
});
