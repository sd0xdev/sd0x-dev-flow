'use strict';

// R7: pins the closed sets in rules/discretion.md — the anchor register, the 12-file baseline
// table, the deviation format and the proposal channel's efficacy boundary. Removing or
// downgrading any pinned item fails here by design: relabelling an anchor is a spec change that
// must be made in BOTH the rule and this test, under human review.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const discretion = readFileSync(resolve(root, 'rules/discretion.md'), 'utf8');
const gitWorkflow = readFileSync(resolve(root, 'rules/git-workflow.md'), 'utf8');
const autoLoop = readFileSync(resolve(root, 'rules/auto-loop.md'), 'utf8');

const MANAGED_FILES = [
  'security.md',
  'logging.md',
  'git-workflow.md',
  'auto-loop.md',
  'codex-invocation.md',
  'fix-all-issues.md',
  'testing.md',
  'docs-writing.md',
  'docs-numbering.md',
  'context-management.md',
  'framework.md',
  'self-improvement.md',
];

function section(doc, heading) {
  const start = doc.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `section "## ${heading}" must exist`);
  const rest = doc.slice(start + heading.length + 3);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

// Strict markdown-table parser: consumes EVERY pipe-line in the section — nothing is filtered by
// "expected shape", so a malformed row, an extra column, or a fourth data row FAILS instead of
// being silently ignored (a filter-then-compare parser lets `| x | y | z | smuggled |` pass by
// slicing the smuggled cell away).
function parseTable(sectionText, expectedHeader) {
  const pipeLines = sectionText.split('\n').filter((l) => l.trim().startsWith('|'));
  assert.ok(pipeLines.length >= 2, 'table must have a header and separator');
  const toCells = (line, n) => {
    const parts = line.split('|');
    assert.equal(parts[0].trim(), '', `row must start with a pipe: ${line}`);
    assert.equal(parts[parts.length - 1].trim(), '', `row must end with a pipe: ${line}`);
    assert.equal(parts.length, n + 2, `row must have exactly ${n} cells, got ${parts.length - 2}: ${line}`);
    return parts.slice(1, -1).map((c) => c.trim());
  };
  const header = toCells(pipeLines[0], expectedHeader.length);
  assert.deepEqual(header, expectedHeader, 'table header drifted');
  assert.match(pipeLines[1], /^\|[-\s|]+\|$/, `second line must be the separator: ${pipeLines[1]}`);
  return pipeLines.slice(2).map((l) => toCells(l, expectedHeader.length));
}

test('tier definition when read → exactly the three tiers Anchor/Default/Guidance, no fourth', () => {
  const rows = parseTable(section(discretion, 'Tiers'), ['Tier', 'Meaning', 'To deviate']);
  assert.equal(rows.length, 3, 'the tier set is closed: exactly three data rows');
  assert.deepEqual(
    rows.map((r) => r[0]),
    ['**Anchor**', '**Default**', '**Guidance**'],
    'exactly these three tiers, in this order — an unbolded fourth row fails the count above'
  );
  assert.match(rows[0][1], /Non-negotiable/, 'Anchor row must say non-negotiable');
  assert.match(rows[1][2], /continue working/i, 'Default deviation must be state-and-continue');
});

test('resolution order when parsed → an Anchor Register hit always resolves to Anchor', () => {
  // The preamble's resolution sentence is the whole mechanism — mutating its target tier
  // ("Register hit → Guidance") would silently downgrade every anchor while the register itself
  // stays intact, so the exact arrow target is pinned here.
  const preamble = discretion.slice(0, discretion.indexOf('\n## '));
  assert.match(preamble, /Anchor Register hit → \*\*Anchor\*\*/, 'register hits must resolve to Anchor, verbatim');
  assert.match(preamble, /exactly one\*\* tier/, 'every instruction resolves to exactly one tier');
});

test('baseline table when parsed → the full 12-row file/baseline/exception mapping is pinned verbatim', () => {
  // deepEqual over ALL THREE columns: flipping a baseline (framework.md → Anchor) or slipping a
  // "→ Anchor" exception into any row would mint a new anchor OUTSIDE the closed register while
  // a files-only check stays green. Every Anchor-producing cell below maps back to a register item.
  const rows = parseTable(
    section(discretion, 'File Baselines (12 plugin-managed files)'),
    ['File', 'Baseline', 'Exceptions above baseline']
  );
  assert.deepEqual(rows, [
    ['`security.md`', '**Anchor**', '— (whole file)'],
    ['`logging.md`', 'Default', '"Never log" list → Anchor'],
    ['`git-workflow.md`', 'Default', 'Forbidden/destructive git ops, protected branches, attribution → Anchor (Register #4); commit containing secrets → Anchor (Register #2)'],
    ['`auto-loop.md`', 'Default', 'Register #5–#7 items → Anchor; § Tiers security/data-integrity escalation → Anchor (Register #3)'],
    ['`codex-invocation.md`', 'Default', '— (the loop-review exception in the file is part of its own contract)'],
    ['`fix-all-issues.md`', 'Default', "Its exception table's logging duty stands as written"],
    ['`testing.md`', 'Default', 'Security / data-integrity / regression AC "❌ Never" rows → Anchor'],
    ['`docs-writing.md`', 'Guidance', 'Comment-block thresholds and move-or-dedupe (no net information loss) → Default'],
    ['`docs-numbering.md`', 'Default', '— (the 500-line limit is the canonical Default example)'],
    ['`context-management.md`', 'Default', '"Context state never overrides auto-loop" and gate-skip prohibition → Anchor (Register #7); no secrets in compact summaries → Anchor (Register #2)'],
    ['`framework.md`', 'Guidance', '—'],
    ['`self-improvement.md`', 'Default', 'Redaction rules (never record secrets) → Anchor (Register #2)'],
  ], 'the classification mapping is closed — changing any cell is a reviewed spec change');
  assert.equal(rows.length, MANAGED_FILES.length);
});

test('override files when classified → excluded from the table and delegated to R8', () => {
  const table = section(discretion, 'File Baselines (12 plugin-managed files)');
  assert.ok(!table.includes('auto-loop-project.md'), 'override files are not classified here');
  assert.ok(!table.includes('testing-project.md'), 'override files are not classified here');
  assert.match(discretion, /auto-loop-project\.md.*testing-project\.md.*out of scope/s);
  assert.match(discretion, /override-contract-migration-r8/, 'R8 ownership must be explicit');
});

test('anchor register when read → covers security, secrets, data integrity and git domains', () => {
  const reg = section(discretion, 'Anchor Register (closed list)');
  assert.match(reg, /all of `rules\/security\.md`/);
  assert.match(reg, /never-log list/);
  assert.match(reg, /no secrets\/tokens\/passwords in compact summaries/);
  assert.match(reg, /data-integrity and regression ACs never take manual exceptions/);
  assert.match(reg, /`reset --hard`/, 'destructive git ops must be enumerated');
});

test('git anchor when phrased → names all three approval workflows (not unconditional)', () => {
  const reg = section(discretion, 'Anchor Register (closed list)');
  assert.match(reg, /`\/push-ci`/);
  assert.match(reg, /`\/smart-commit --execute`/);
  assert.match(reg, /`\/epic-merge`/);
  assert.match(reg, /exception list is part of the anchor/i);
});

test('approval workflows when pinned → each keeps its exact operations, approval step and credential', () => {
  // Name-presence alone is bypassable ("/push-ci may commit without approval" still contains the
  // name). Pin each workflow's full contract in the source rule: which git operations, that
  // explicit user approval via AskUserQuestion is required, and (for push) the terminal gate.
  assert.match(gitWorkflow,
    /`\/push-ci` skill may execute `git push` after explicit user approval via AskUserQuestion/);
  assert.match(gitWorkflow,
    /`\/smart-commit --execute` may execute `git add` \+ `git commit` after explicit user approval via AskUserQuestion/);
  assert.match(gitWorkflow,
    /`\/epic-merge` skill may execute `git rebase --onto`, `git push --force-with-lease`, and `gh pr merge --squash` after explicit per-iteration user approval via AskUserQuestion/);
  assert.match(gitWorkflow, /Primary gate = `pre-push-gate\.sh` \(git hook, `\/dev\/tty` confirmation\)/,
    'push keeps its stronger terminal credential');
});

test('approval workflows when implemented → each SKILL.md still carries its approval contract', () => {
  const pushCi = readFileSync(resolve(root, 'skills/push-ci/SKILL.md'), 'utf8');
  assert.match(pushCi, /Push REQUIRES explicit user approval via AskUserQuestion/, '/push-ci approval step intact');
  const smartCommit = readFileSync(resolve(root, 'skills/smart-commit/SKILL.md'), 'utf8');
  assert.match(smartCommit, /must use `AskUserQuestion` for approval before executing commits/,
    '/smart-commit --execute approval step intact');
  const epicMerge = readFileSync(resolve(root, 'skills/epic-merge/SKILL.md'), 'utf8');
  assert.match(epicMerge, /destructive iteration is gated by `AskUserQuestion`/,
    '/epic-merge per-iteration approval step intact');
});

test('auto-loop anchors when registered → all four present here and in rules/auto-loop.md', () => {
  const reg = section(discretion, 'Anchor Register (closed list)');
  for (const phrase of [
    'terminal completion invariant',
    'Declaring ≠ Executing',
    'Summary ≠ Completion',
    'Fixing ≠ Verifying',
  ]) {
    assert.ok(reg.toLowerCase().includes(phrase.toLowerCase()), `register must list "${phrase}"`);
    assert.ok(autoLoop.toLowerCase().includes(phrase.toLowerCase()), `rules/auto-loop.md must still state "${phrase}"`);
  }
});

test('loop obligations when registered → edit re-opens gate, tier is depth-only, edit resets cycle', () => {
  const reg = section(discretion, 'Anchor Register (closed list)');
  assert.match(reg, /re-opens its plane's gate/);
  assert.match(reg, /depth\*\* only — never \*\*whether\*\*/);
  assert.match(reg, /resets the review cycle/);
  assert.match(reg, /No register item may be re-labelled Default or Guidance/);
});

test('anchor register when enumerated → exactly the seven closed items, none downgraded', () => {
  const reg = section(discretion, 'Anchor Register (closed list)');
  const items = reg.split('\n').filter((l) => /^\d+\./.test(l));
  // Closed in BOTH directions: removal breaks protection, silent addition means an unreviewed
  // instruction became non-negotiable without touching this test — either way, fail here.
  assert.deepEqual(
    items.map((l) => l.match(/^\d+\. \*\*([^*]+)\*\*/)[1]),
    [
      'Security prohibitions',
      'Secret recording',
      'Data integrity',
      'Destructive git operations',
      'Auto-loop anchors',
      'Loop obligations',
      'Gate supremacy',
    ],
    'the register is a closed list: exactly these seven identifiers, in this order'
  );
  for (const item of items) {
    assert.ok(!/→ (Default|Guidance)/.test(item), `register item may not downgrade: ${item.slice(0, 60)}`);
  }
  // git-workflow.md § Prohibited bans committing secrets; the register must carry it or the
  // baseline table's "secrets → Register" pointer dangles into an entry that never says it.
  const secretItem = items.find((l) => l.includes('**Secret recording**'));
  assert.match(secretItem, /no commit containing secrets/i);
  assert.match(secretItem, /git-workflow\.md/);
});

test('git anchor attribution clause when read → carries the /smart-commit --ai-co-author whitelist exception', () => {
  // Written unconditionally, the attribution anchor would erase the opt-in that CLAUDE.md and
  // skills/smart-commit/SKILL.md both define — and discretion.md itself says an anchor's
  // exceptions are part of the contract, so the whitelist must live IN the register entry.
  const reg = section(discretion, 'Anchor Register (closed list)');
  assert.match(reg, /--ai-co-author/);
  assert.match(reg, /Co-Authored-By: Claude <noreply@anthropic\.com>/, 'the exact whitelisted line is the exception');
  const claudeMd = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /--ai-co-author/, 'the opt-in the anchor excepts must still exist in CLAUDE.md');
  const smartCommit = readFileSync(resolve(root, 'skills/smart-commit/SKILL.md'), 'utf8');
  assert.match(smartCommit, /Co-Authored-By: Claude <noreply@anthropic\.com>/, 'and in the skill that implements it');
});

test('deviation format when defined → requires a named fact signal and is not a request', () => {
  const dev = section(discretion, 'Deviating from a Default');
  assert.match(dev, /\[DEVIATION\]/);
  assert.match(dev, /signal=</);
  assert.match(dev, /AUTO_LOOP_STATE/, 'fact signals must be exemplified concretely');
  assert.match(dev, /statement, not a request/i);
  assert.match(dev, /Silent deviation is a violation/);
});

test('proposal channel when triggered → closed set, and uncertainty is explicitly excluded', () => {
  const prop = section(discretion, 'Proposal Channel (efficacy boundary)');
  assert.match(prop, /closed set/);
  assert.match(prop, /conflicts with an Anchor/);
  assert.match(prop, /irreversible/);
  assert.match(prop, /Uncertainty is NOT a trigger/);
  assert.match(prop, /do not stop to wait for a reply/);
  // The closed set governs rule-deviation approvals only — it must not read as revoking
  // auto-loop.md's own Need Human exits (REQUIREMENT_AMBIGUITY, architecture change, user stop).
  assert.match(prop, /scoped to rule-deviation approval only/);
  assert.match(prop, /this file does not narrow/);
  assert.match(prop, /REQUIREMENT_AMBIGUITY/);
  assert.match(prop, /remain fully in force/);
  // REQUIREMENT_AMBIGUITY is a cap-diagnostic class, not a global ask-anytime channel:
  // the exit must stay conditioned on the round cap being reached.
  assert.match(prop, /round cap is reached.*REQUIREMENT_AMBIGUITY/s);
  assert.match(prop, /ordinary requirement uncertainty before the cap does not trigger it/);
});

test('efficacy boundary when scoped → limits AskUserQuestion without revoking the enumerated workflows', () => {
  const prop = section(discretion, 'Proposal Channel (efficacy boundary)');
  assert.match(prop, /session caching/);
  assert.match(prop, /never the sole credential for a safety approval outside the workflow that defines it/);
  assert.match(prop, /pre-push-gate\.sh/, 'push keeps its stronger named mechanism');
  assert.match(prop, /that names no stronger mechanism/,
    'the sufficiency clause must not cover workflows with a stronger named credential');
  assert.match(prop, /`\/smart-commit --execute` and `\/epic-merge` operate on exactly that contract/,
    'workflows whose defined credential IS per-use AskUserQuestion stay valid');
  assert.match(prop, /`\/push-ci`.*`pre-push-gate\.sh` is the terminal credential/,
    'push is explicitly carved out of the sufficiency clause');
  assert.match(prop, /Authorization is never a reason to skip review/);
});

test('CLAUDE.md tracked templates when loading rules → both reference @rules/discretion.md', () => {
  // Only the two git-tracked templates are asserted: .claude/CLAUDE.md is gitignored and
  // user-owned, so a clean clone does not have it — its content is produced by project-setup
  // backfill from CLAUDE.template.md, which is covered by asserting the template itself.
  for (const f of ['CLAUDE.md', 'CLAUDE.template.md']) {
    const text = readFileSync(resolve(root, f), 'utf8');
    assert.ok(text.includes('@rules/discretion.md'), `${f} must import the tier registry`);
  }
});

// AC5 before/after comparison. FROZEN BEFORE-ORACLE: this inventory was captured by hand
// from the pre-R7 rules files at migration time (2026-07-29) and is deliberately a frozen
// list, not derived at runtime — deriving "before" from files that later edits can change
// would make the oracle drift with the mutation it is meant to catch. Each entry asserts
// (a) the pre-change anchor source phrase still exists in its file and (b) the register or
// baseline table maps it to Anchor. Editing this list is itself an Anchor-level spec change.
const FROZEN_ANCHOR_INVENTORY = [
  // security.md — every Prohibited row, whole-file anchor via the baseline table
  { file: 'rules/security.md', phrase: /MD5\/SHA1 for security/, mapped: /all of `rules\/security\.md`/ },
  { file: 'rules/security.md', phrase: /Direct execution of user input/, mapped: /all of `rules\/security\.md`/ },
  { file: 'rules/security.md', phrase: /Logging private keys\/passwords\/tokens/, mapped: /all of `rules\/security\.md`/ },
  { file: 'rules/security.md', phrase: /fetch\(req\.query\.url\)/, mapped: /all of `rules\/security\.md`/ },
  { file: 'rules/security.md', phrase: /Unverified resource ownership/, mapped: /all of `rules\/security\.md`/ },
  // logging.md — the never-log list
  { file: 'rules/logging.md', phrase: /Never log: Private keys \| Mnemonics \| API keys \| Passwords/, mapped: /`logging\.md` never-log list/ },
  // git-workflow.md — forbidden ops, protected branches, force push, commit secrets
  { file: 'rules/git-workflow.md', phrase: /Claude forbidden: git add \| commit \| push \| stash \| reset --hard \| rebase/, mapped: /`git add` \/ `commit` \/ `push` \/ `stash` \/ `reset --hard` \/ `rebase`/ },
  { file: 'rules/git-workflow.md', phrase: /Protected branches: main \| master \| develop \| release\/\*/, mapped: /Protected branches .* are part of this anchor/ },
  { file: 'rules/git-workflow.md', phrase: /Force push to shared branches/, mapped: /no `git add` \/ `commit` \/ `push`/ },
  { file: 'rules/git-workflow.md', phrase: /Commit containing secrets/, mapped: /no commit containing secrets/ },
  // testing.md — all three ❌ Never rows, each mapped individually
  { file: 'rules/testing.md', phrase: /\| Security AC \| ❌ Never \|/, mapped: /security, data-integrity and regression ACs never take manual exceptions/ },
  { file: 'rules/testing.md', phrase: /\| Data-integrity AC \| ❌ Never \|/, mapped: /security, data-integrity and regression ACs never take manual exceptions/ },
  { file: 'rules/testing.md', phrase: /\| Regression AC \| ❌ Never \|/, mapped: /security, data-integrity and regression ACs never take manual exceptions/ },
  // auto-loop.md — the terminal invariant, the three ≠ corollaries, cycle reset
  { file: 'rules/auto-loop.md', phrase: /[Tt]erminal completion invariant/, mapped: /terminal completion invariant/ },
  { file: 'rules/auto-loop.md', phrase: /Declaring ≠ Executing.*Summary ≠ Completion.*Fixing ≠ Verifying/s, mapped: /Declaring ≠ Executing; Summary ≠ Completion; Fixing ≠ Verifying/ },
  { file: 'rules/auto-loop.md', phrase: /any code edit invalidates prior verdicts/, mapped: /any code edit resets the review cycle/ },
  // context-management.md — gate supremacy and compact-summary secrets
  { file: 'rules/context-management.md', phrase: /Context state never overrides auto-loop/, mapped: /context capacity or session length never overrides an open gate/ },
  { file: 'rules/context-management.md', phrase: /Never put secrets, tokens, or passwords in a compact summary/, mapped: /no secrets\/tokens\/passwords in compact summaries/ },
];

test('legacy anchors when migrated → every pre-change anchor source still exists and maps to the register', () => {
  const reg = section(discretion, 'Anchor Register (closed list)');
  const baselines = section(discretion, 'File Baselines (12 plugin-managed files)');
  const mappingTargets = reg + baselines;
  for (const { file, phrase, mapped } of FROZEN_ANCHOR_INVENTORY) {
    const src = readFileSync(resolve(root, file), 'utf8');
    assert.match(src, phrase, `pre-change anchor source vanished from ${file}: ${phrase}`);
    assert.match(mappingTargets, mapped, `register/baseline lost the migrated anchor from ${file}: ${mapped}`);
  }
  // Whole-file anchor for security.md must also survive as a baseline cell, and the file
  // must retain its substance (an emptied file would defeat every per-row check above,
  // but guard the prohibited-table shell too).
  assert.match(baselines, /\| `security\.md` \| \*\*Anchor\*\* \|/);
  const security = readFileSync(resolve(root, 'rules/security.md'), 'utf8');
  assert.match(security, /\| Prohibited\s+\| Guidance\s+\|/, 'security.md prohibited table header must survive');
});

// AC9 negative half: patterns that catch wording granting discretion over WHETHER review
// runs. Grants are modal/permission structures — a negation ("never skip review") or a
// mandate ("must not omit review") is anchor-strengthening prose and must NOT match, so
// every pattern requires a permissive modal (may/can/could/might/free to) or an explicit
// no-requirement form, never the bare verb.
const REVIEW_GRANT_PATTERNS = [
  /(?:\breview\b|\bre-review\b)[^.\n]{0,30}\b(?:may|can|could|might)\s+be\s+(?:skipped|omitted|waived)/i,
  /\b(?:may|can|could|might|is free to)\s+(?:skip|omit|waive)\b[^.\n]{0,30}\breview\b/i,
  /\b(?:may|can|could|might|is free to)\b[^.\n]{0,60}\b(?:decide|choose|judge)\b[^.\n]{0,40}\bwhether\b[^.\n]{0,40}\breview\b/i,
  /\breview\b[^.\n]{0,20}\b(?:is|remains|becomes)\s+(?:optional|discretionary)\b/i,
  /\bno\s+review\s+is\s+(?:required|needed)\b/i,
  /\breview\s+(?:is\s+not|isn't)\s+(?:required|needed)\b/i,
  /\breview\s+need\s+not\s+run\b/i,
  /\b(?:may|can|could|might|is free to)\s+proceed\s+without\b[^.\n]{0,20}\breview\b/i,
];

test('review-grant patterns when self-tested → hit every grant fixture and no anchor-strengthening fixture', () => {
  // Control fixtures validate the regexes themselves, independent of what auto-loop.md
  // happens to say today — a scanner that cannot catch these grants proves nothing below.
  const mustHit = [
    'Review may be skipped for documentation changes.',
    'Review can be omitted for low-risk edits.',
    'The re-review might be waived when the diff is small.',
    'The model may skip the review for comments.',
    'The model is free to decide for itself whether a review is warranted.',
    'Review is optional for trivial edits.',
    'Review is discretionary.',
    'No review is required for comments.',
    'Review is not required for documentation changes.',
    "A review isn't needed for comments.",
    'The model may proceed without review.',
    'Review need not run for this change.',
  ];
  const mustMiss = [
    'Never skip review.',
    'Do not omit the review.',
    'The model must not waive review.',
    'Review must never be skipped.',
    'Review is not optional.',
    'Review is never discretionary.',
    'The gate must never proceed without review.',
    'skip this protocol entirely: cap hit → Need Human',
    '[PLAN_REVIEW_SKIPPED]',
    'tier decides review depth only',
  ];
  for (const s of mustHit) {
    assert.ok(REVIEW_GRANT_PATTERNS.some((p) => p.test(s)), `grant fixture must be caught: ${s}`);
  }
  for (const s of mustMiss) {
    assert.ok(!REVIEW_GRANT_PATTERNS.some((p) => p.test(s)), `non-grant fixture must not match: ${s}`);
  }
});

test('auto-loop.md when scanned → carries no review-optional wording that would contradict the anchors', () => {
  // Bracketed sentinel tokens ([PLAN_REVIEW_SKIPPED], [NIT_DEFERRED], …) are hook-protocol
  // vocabulary, not prose granting discretion — strip them so they cannot false-positive.
  const autoLoop = readFileSync(resolve(root, 'rules/auto-loop.md'), 'utf8').replace(/\[[A-Z_]+\]/g, '');
  for (const pat of REVIEW_GRANT_PATTERNS) {
    assert.ok(!pat.test(autoLoop), `review-optional wording found in rules/auto-loop.md: ${pat}`);
  }
  // The bounding sentence the judgment clause hangs off must survive verbatim.
  assert.match(autoLoop, /tier decides review \*\*depth\*\* only|the invariant constrains the end state/);
});
