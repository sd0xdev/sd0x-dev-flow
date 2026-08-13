'use strict';

// R8: pins claude-health S2.5 check #6 — legacy comment-only precedence headers on installed
// override copies are REPORTED, never rewritten. The detection logic mirror below is the
// behavioural contract: a comment-form Precedence with no live line flags, anything with a
// live Precedence line does not.
//
// The shipped skill is read as LIVE TEXT, not raw bytes. Reading raw bytes is the defect this
// whole ticket exists to prevent, one file late: wrapping S2.5 in a fenced block left every
// positive assertion below green while the model received an example rather than active guidance.
// Structural gate, exactly-one live section extraction, and a complete-region equality pin are
// what make the assertions evidence. Parser and rationale:
// test/helpers/markdown-structure.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { liveLines, liveText, sectionAt, structuralViolations } = require('../helpers/markdown-structure');

const root = resolve(__dirname, '../..');
const rawSkill = readFileSync(resolve(root, 'skills/claude-health/SKILL.md'), 'utf8');
const skill = liveText(rawSkill);

const S25 = 'S2.5: Override Safeguard Checks';

/** The one live S2.5 section. A fenced or commented copy is not a section, and two are not one. */
function s25(text) {
  return sectionAt(text, 4, S25);
}

/** The one live S1-S3 check region that owns S2.5 and every sibling beside it. */
function syncChecks(text) {
  return sectionAt(text, 3, 'Sync Module \u2014 Checks (S1-S3)');
}

const normalize = (t) => t.split(String.fromCharCode(0)).join('').replace(/\s+/g, ' ').trim();

/** Mirror of check #6: flag when the precedence declaration lives ONLY in a comment. */
function hasLegacyPrecedenceHeader(content) {
  const firstHeading = content.search(/^## /m);
  const pre = firstHeading === -1 ? content : content.slice(0, firstHeading);
  const hasCommentForm = /<!--\s*Precedence:/.test(content);
  const hasLiveForm = /^Precedence:/m.test(pre);
  return hasCommentForm && !hasLiveForm;
}

/** The complete parent check region, not the S2.5 body alone. Pinning the child left a sibling
 *  free: `#### S2.6: Override Safeguard Exception` inserted before S3 kept the S2.5 body
 *  byte-identical while adding "The S2.5 checks are advisory and may be skipped." next to it.
 *  S1-S3 is the boundary the safeguard contract actually has. Fenced examples inside the region are
 *  masked, so an example block is not pinned prose — that is the intended reading. */
const CANONICAL_SYNC_CHECKS =
  '> Only runs when `--scope sync` or `--scope all` (default). #### S1: Version Check | # | Check ' +
  '| Method | Criteria | |---|-------|--------|----------| | S1.1 | Manifest exists | Read ' +
  '`.sd0x/install-state.json` | Missing → P1 | | S1.2 | Manifest parseable | JSON.parse | Parse ' +
  'error → P1 | | S1.3 | `schema_version` current | `== 1` | Mismatch → P2 | | S1.4 | ' +
  '`plugin_version` matches | manifest vs `.claude-plugin/plugin.json` or `package.json` | ' +
  'Mismatch → P1 | | S1.5 | Manifest completeness | Has `rules` + `hook_scripts` + `scripts` keys ' +
  '| Missing key → P2 (`MANIFEST_GAP`) | **Plugin version resolution** (priority order): **Plugin ' +
  'source location** (same as `/install-rules` Phase 1): #### S2: Component Classification For ' +
  'each managed component (rules, hooks, scripts), compute 3 hashes and classify: **Classification ' +
  'table** (read-only diagnostic; maps to install-rules states for delegation): | Doctor State | ' +
  'Condition | Severity | install-rules Equivalent | ' +
  '|-------|-----------|----------|--------------------------| | `OK` | local == manifest == ' +
  'plugin | ✅ | `SKIP` | | `MISSING` | local_hash is null, plugin exists | P1 | `FRESH_INSTALL` | ' +
  '| `OUTDATED` | local == manifest, plugin != manifest | P1 | `AUTO_UPDATE` | | `LOCAL_MODIFIED` ' +
  '| local != manifest, plugin == manifest | ✅ | `KEEP_LOCAL` | | `CONFLICT` | local != manifest, ' +
  'plugin != manifest | P2 | `CONFLICT` | | `LEGACY` | manifest_hash is null, local exists | P2 | ' +
  '`LEGACY` | | `MANIFEST_GAP` | manifest category key missing | P2 | N/A | | `TOMBSTONED` | ' +
  'manifest `deleted: true`, local missing | ✅ | `SKIP_DELETED` | **Managed inventory** ' +
  '(hardcoded): | Category | Local Path | Plugin Source | Files | ' +
  '|----------|-----------|--------------|-------| | Rules | `.claude/rules/*.md` | `rules/*.md` | ' +
  '`auto-loop.md`, `codex-invocation.md`, `fix-all-issues.md`, `framework.md`, `testing.md`, ' +
  '`security.md`, `git-workflow.md`, `logging.md`, `docs-writing.md`, `docs-numbering.md`, ' +
  '`self-improvement.md`, `context-management.md` | | Hooks | `.claude/hooks/*.sh` | `hooks/*.sh` ' +
  '| `pre-edit-guard.sh`, `post-edit-format.sh`, `post-skill-auto-loop.sh`, ' +
  '`post-compact-auto-loop.sh`, `stop-guard.sh`, `user-prompt-review-guard.sh` | | Scripts | ' +
  '`.claude/scripts/` | `scripts/` | `precommit-runner.js`, `verify-runner.js`, `review-state.js`, ' +
  '`dep-audit.sh`, `commit-msg-guard.sh`, `pre-push-gate.sh`, `lib/utils.js`, `lib/tree-digest.js` ' +
  '| #### S2.5: Override Safeguard Checks 6 checks for project override files (e.g., ' +
  '`auto-loop-project.md`): | # | Check | Severity | Detection | Recommendation | ' +
  '|---|-------|----------|-----------|----------------| | 1 | Override drift | P2 | `based_on` ' +
  'hash comment in project file vs the hash of **the base file that comment names** (derived, ' +
  'never hard-coded — both `auto-loop-project.md` and `testing-project.md` ship) — **only when the ' +
  'override file has active content**; a scaffold with every section still commented out has no ' +
  'overrides to review, so drift is not reported | "Base `<rule>` updated since override authored; ' +
  'review your overrides" | | 2 | Policy contradiction | P1 | An overridden section omits a ' +
  'required check command that the **same section** of the base rule contains | "Override drops a ' +
  'required check command its base section carries" | | 3 | Missing reference or base | P1 | For ' +
  '**each** shipped override file (`auto-loop-project.md`, `testing-project.md`): ' +
  '`.claude/CLAUDE.md` has `@rules/<file>` but the file is missing, OR the file exists but is not ' +
  'referenced, OR the file exists but the base rule its `Based on:` comment names is missing from ' +
  '`.claude/rules/` | `/install-rules` to recreate the missing file or base, or add the reference ' +
  '| | 4 | Wrong-layer edit | P2 | Base `auto-loop.md` has `LOCAL_MODIFIED`, `CONFLICT`, or ' +
  '`LEGACY` state while project override exists | "Move customization to auto-loop-project.md" | | ' +
  '5 | Duplicate heading | P2 | Override file has multiple active `## <heading>` with same text | ' +
  '"Keep one, remove duplicates. Last occurrence takes effect." | | 6 | Legacy precedence header | ' +
  'P2 | Precedence declaration exists only inside an HTML comment (`<!-- Precedence:` present, no ' +
  'live `Precedence:` line before the first `##`) — HTML comments are stripped from model context ' +
  '(R8), so the declaration never reaches its only reader | "Header predates the live-precedence ' +
  'contract; migrate the precedence line to live text by hand or regenerate via `/install-rules ' +
  '--customize <rule> --reset`. This check is **read-only** — it never edits the user-owned file" ' +
  '| **Policy contradiction detection**: For each `## <heading>` section the override restates, ' +
  'extract the backticked check commands (`/codex-review-fast`, `/codex-review-doc`, `/precommit`) ' +
  'from the **same-heading section of the base `auto-loop.md`** and require the restated section ' +
  'to keep every one of them. A verbatim copy therefore never flags; only a restatement that ' +
  '*drops* a command its base section carries is P1. (The base\'s Auto-Trigger table was retired by ' +
  'R3 — code/doc routing now lives in the unheaded terminal-invariant paragraph, which the ' +
  'exact-`##`-heading override mechanism cannot restate, so routing itself is not overridable and ' +
  'is out of this check\'s scope.) No restated section → check passes vacuously. **Override drift ' +
  'detection**: First check whether the project file has **active content**. Two forms count, and ' +
  'the distinction matters because the scaffold ships its `##` headings live: a non-empty, ' +
  'non-comment **body line** under any heading, or a **heading that carries its own value** (`## ' +
  'Plan Review: enabled`, `## Git Memory: enabled` — for these settings the heading *is* the ' +
  'value, so there is no body to look for). A bare scaffold heading with nothing but comments ' +
  'beneath it is an empty slot, not an override. The live `Precedence:` header is preamble ' +
  'material and never activation. A scaffold whose sections are all still commented out is ' +
  'skipped: drift means "the base changed since you wrote your overrides", and there are none, so ' +
  'reporting it on a fresh install is a false positive rather than a finding. Otherwise read the ' +
  '`<!-- Based on: <base>.md @ <hash> -->` comment and **derive the base file from the comment\'s ' +
  'own filename** — `git hash-object --no-filters .claude/rules/<base>.md | cut -c1-7`. The base ' +
  'must not be hard-coded: R8 distributes `testing-project.md` alongside `auto-loop-project.md`, ' +
  'so a fixed `auto-loop.md` comparand would check a testing override\'s hash against the wrong ' +
  'rule and report drift that does not exist. If the derived base file is missing, drift is ' +
  'undefined rather than zero — report it through check #3\'s **missing base** branch (P1) and do ' +
  'not emit a drift finding. Both checks must cover every shipped override file, not just ' +
  '`auto-loop-project.md`: an active `testing-project.md` whose `testing.md` has been deleted ' +
  'would otherwise fall through both. If the hashes differ, the base has been updated since the ' +
  'override was authored. Uses blob hash for content-level comparison; accepts legacy commit-style ' +
  'hashes (any 7+ hex chars) during backward-compat transition. #### S3: Settings Compatibility ' +
  'Check **both** `settings.json` and `settings.local.json` (precedence: `settings.local.json` > ' +
  '`settings.json`). A hook entry in either file satisfies the integrity check. | # | Check | ' +
  'Method | Criteria | |---|-------|--------|----------| | S3.1 | Legacy hook paths | Grep both ' +
  'settings files for bare `.claude/hooks/` without `$CLAUDE_PROJECT_DIR` | Found → P2 | | S3.2 | ' +
  'Retired guard-mode setting | Read `env.STOP_GUARD_MODE` (and legacy ' +
  '`hooks_config.stop_guard_mode`) from either settings file | Found in either → P2 (retired: the ' +
  'Stop hook is reminder-only since hook-lightweighting — the setting is dead config, recommend ' +
  'removing it). Absent → ✅ | | S3.3 | Hook entry integrity | Each installed hook script has ' +
  'matching entry in either settings file | Missing from both → P1 | | S3.4 | Orphan hook entries ' +
  '| Either settings file references script that doesn\'t exist on disk | Orphan → P2 | **Settings ' +
  'file precedence**: `settings.local.json` overrides `settings.json` at runtime. When delegating ' +
  'S3 fixes, use `/install-hooks --local` if the issue is in `settings.local.json`. **Legacy path ' +
  'detection**:';

test('the shipped skill when parsed → carries no construct the scanner cannot model', () => {
  assert.deepEqual(structuralViolations(rawSkill), [],
    'claude-health/SKILL.md must stay inside the guarded Markdown subset — see markdown-structure.js');
});

test('S2.5 when retracted, fenced or duplicated → fails its region pin', () => {
  assert.equal(normalize(syncChecks(skill)), CANONICAL_SYNC_CHECKS,
    'the S1-S3 check region changed — review the complete diff, including any sibling subsection added beside S2.5; confirm no check was dropped, retracted or qualified from anywhere in the region, then update the pin');

  // The mutation that every raw-byte assertion in this file used to survive.
  const fenced = rawSkill.replace(`#### ${S25}`, `\`\`\`markdown\n#### ${S25}`)
    .replace('#### S3: Settings Compatibility', '\`\`\`\n\n#### S3: Settings Compatibility');
  assert.match(fenced, /Legacy precedence header/,
    'fixture premise: the raw bytes still contain check #6, so a raw-byte assertion cannot see this');
  assert.doesNotMatch(liveText(fenced), /Legacy precedence header/,
    'fixture premise: as live text the guidance is gone — it renders as an example');
  assert.throws(() => s25(liveText(fenced)), /expected exactly one live heading/,
    'a fenced S2.5 must fail extraction, not be read as active guidance');

  // A sibling subsection contradicting S2.5 from beside it, with S2.5 itself untouched.
  const sibling = rawSkill.replace('#### S3: Settings Compatibility',
    '#### S2.6: Override Safeguard Exception\n\nThe S2.5 checks are advisory and may be skipped.\n\n#### S3: Settings Compatibility');
  const siblingLive = liveText(sibling);
  assert.equal(normalize(s25(siblingLive)), normalize(s25(skill)),
    'fixture premise: the S2.5 body is byte-identical, so a child-section pin cannot see this');
  assert.match(siblingLive, /advisory and may be skipped/,
    'fixture premise: the contradiction is live text, not a comment or an example');
  assert.notEqual(normalize(syncChecks(siblingLive)), CANONICAL_SYNC_CHECKS,
    'the region pin must reject a sibling that qualifies the checks from outside S2.5');

  // A second S2.5 restating the checks differently must not hide behind the first.
  const duplicated = liveText(`${rawSkill}\n#### ${S25}\n\n5 checks; the legacy header check was withdrawn.\n`);
  assert.throws(() => s25(duplicated), /expected exactly one live heading/,
    'two S2.5 sections must fail uniqueness');
});

/** The live H1-H3 heading sequence. Levels are filtered to the region's own depth because that is
 *  what decides where the region ENDS: an H4 inside it is body, an H3 beside it is a terminator. */
function topHeadings(text) {
  const live = liveLines(text);
  return text.split('\n')
    .filter((l, i) => live[i] && /^ {0,3}#{1,3}[ \t]/.test(l))
    .map((l) => l.trim());
}

test('a same-level exception section beside the check region → fails the heading-sequence pin', () => {
  // Pinning the region body leaves its terminator open, and the terminator is where the escape
  // is: a `### Sync Module — Exception` inserted immediately before `### Fix Tiers` lands exactly
  // where the region already ended, so the body it pins is byte-identical while the shipped skill
  // now carries live guidance retracting check #6. Same closure as the Override Template Copy
  // Contract uses — pin the neighbourhood, not just the payload.
  const sequence = topHeadings(rawSkill);
  const at = sequence.indexOf('### Sync Module — Checks (S1-S3)');
  assert.notEqual(at, -1, 'the check region heading is among the live H1-H3 headings');
  assert.deepEqual(sequence.slice(at - 1, at + 2),
    ['### Check 7: Cache Size', '### Sync Module — Checks (S1-S3)', '### Fix Tiers'],
    'a section was inserted next to the check region — confirm it does not qualify or retract the checks, then update this sequence');

  const excepted = rawSkill.replace('### Fix Tiers',
    '### Sync Module — Exception\n\nS2.5 may be skipped when a legacy header appears intentional.\n\n### Fix Tiers');
  const live = liveText(excepted);
  assert.match(live, /may be skipped when a legacy header appears intentional/,
    'fixture premise: the retraction is live text');
  assert.equal(normalize(syncChecks(live)), CANONICAL_SYNC_CHECKS,
    'fixture premise: the region body is byte-identical, so the region pin cannot see this');
  assert.notDeepEqual(topHeadings(excepted).slice(at - 1, at + 2),
    ['### Check 7: Cache Size', '### Sync Module — Checks (S1-S3)', '### Fix Tiers'],
    'the sequence pin must reject an exception section inserted at the region boundary');
});

test('S2.5 when read → declares six override checks including the legacy precedence header', () => {
  const section = s25(skill);
  assert.match(section, /6 checks for project override files/);
  const rows = section.split('\n').filter((l) => /^\| \d+ \|/.test(l));
  assert.equal(rows.length, 6, 'exactly six numbered check rows');
  assert.match(rows[5], /Legacy precedence header/, 'check #6 is the legacy header detection');
  assert.match(rows[5], /P2/, 'severity P2 — a reporting concern, not a broken gate');
});

test('check #6 when specified → detection is comment-only-precedence, remediation is user-driven', () => {
  const section = s25(skill);
  assert.match(section, /<!-- Precedence:/, 'detection names the comment form');
  assert.match(section, /no live `Precedence:` line before the first `##`/, 'detection requires the live line to be absent');
  assert.match(section, /stripped from model context/, 'the rationale (R8 finding) is stated');
  assert.match(section, /--customize <rule> --reset|migrate the precedence line/, 'remediation offered');
});

test('check #6 when scoped → explicitly read-only, never edits the user-owned file', () => {
  const section = s25(skill);
  assert.match(section, /\*\*read-only\*\*/, 'non-mutation is explicit');
  assert.match(section, /never edits the user-owned file/, 'ownership contract stated');
});

test('legacy detection mirror when applied → flags comment-only headers, passes live and dual headers', () => {
  const legacy = [
    '# Auto-Loop Project Overrides',
    '<!-- Precedence: When this file conflicts with auto-loop.md, this file takes precedence. -->',
    '<!-- Based on: auto-loop.md @ abc1234 -->',
    '## Tier',
  ].join('\n');
  assert.equal(hasLegacyPrecedenceHeader(legacy), true, 'comment-only header is legacy');

  const live = [
    '# Auto-Loop Project Overrides',
    'Precedence: an active `##` section here replaces the same-heading section — Default/Guidance only.',
    '<!-- Based on: auto-loop.md @ abc1234 -->',
    '## Tier',
  ].join('\n');
  assert.equal(hasLegacyPrecedenceHeader(live), false, 'live header is current');

  const dual = [
    '# Auto-Loop Project Overrides',
    'Precedence: live declaration here.',
    '<!-- Precedence: stale comment kept by the user -->',
    '## Tier',
  ].join('\n');
  assert.equal(hasLegacyPrecedenceHeader(dual), false, 'a live line satisfies the contract even beside a stale comment');

  const none = ['# Fresh File', '## Tier'].join('\n');
  assert.equal(hasLegacyPrecedenceHeader(none), false, 'no declaration at all is not the legacy pattern (check #3 territory)');
});

test('shipped templates when checked → neither trips the legacy detection', () => {
  for (const f of ['rules/auto-loop-project.md', 'rules/testing-project.md']) {
    const content = readFileSync(resolve(root, f), 'utf8');
    assert.equal(hasLegacyPrecedenceHeader(content), false, `${f} must ship with the live header`);
  }
});

// --- Check #1 (override drift) must not fire on a scaffold with nothing overridden ---

/** Mirror of the active-content precondition. Two things count as activation, and conflating
 *  them was a real defect the code review caught: a non-comment BODY line under a heading, and a
 *  heading that carries its own value (`## Plan Review: enabled`) — for those settings the
 *  heading IS the value, so waiting for a body line means a genuinely enabled override reads as
 *  dormant. A bare scaffold heading is an empty slot; the shipped templates ship all six live,
 *  which is why "any non-comment line" cannot be the rule. The live `Precedence:` paragraph sits
 *  in the preamble and is header material, never activation. */
function hasActiveOverrides(content) {
  const firstHeading = content.search(/^ {0,3}## /m);
  if (firstHeading === -1) return false;
  let inComment = false;
  for (const raw of content.slice(firstHeading).split('\n')) {
    const line = raw.trim();
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true;
      continue;
    }
    if (line === '') continue;
    if (/^## /.test(line)) {
      // Heading-form setting: the value rides on the heading itself.
      if (/^## [^:]+:\s*\S/.test(line)) return true;
      continue;
    }
    return true;
  }
  return false;
}

test('check #1 when specified → drift is gated on the override file having active content', () => {
  // Without this precondition a fresh install reports P2 drift the moment the base rule moves on
  // from whatever hash the shipped template recorded — the copy is byte-for-byte, so the consumer
  // inherits a stale `Based on:` value and is told to "review your overrides" that do not exist.
  const section = s25(skill);
  const row1 = section.split('\n').find((l) => /^\| 1 \|/.test(l));
  assert.ok(row1, 'check #1 row must exist');
  assert.match(row1, /only when the override file has active content/,
    'the drift row states the precondition');
  assert.match(section, /A scaffold whose sections are all still commented out is skipped/,
    'the detection paragraph states the skip');
  assert.match(section, /false positive rather than a finding/,
    'the rationale is recorded so the precondition is not "simplified" away later');
});

test('active-override mirror when applied → shipped scaffolds are inactive, an uncommented setting is active', () => {
  for (const f of ['rules/auto-loop-project.md', 'rules/testing-project.md']) {
    const content = readFileSync(resolve(root, f), 'utf8');
    assert.equal(hasActiveOverrides(content), false,
      `${f} ships fully commented out, so drift must be skipped for a fresh install`);
  }
  const activated = [
    '# Auto-Loop Project Overrides',
    'Precedence: live header text that must not count as activation.',
    '<!-- Based on: auto-loop.md @ abc1234 -->',
    '## Tier',
    '',
    'thorough',
  ].join('\n');
  assert.equal(hasActiveOverrides(activated), true, 'an uncommented setting value is a real override');

  // Heading-form settings: `## Plan Review: enabled` has no body line, so a body-only rule reads
  // an enabled override as dormant and silently skips drift for a user who HAS customized.
  for (const heading of ['## Plan Review: enabled', '## Git Memory: enabled', '## Think Harder: enabled']) {
    const headingForm = [
      '# Auto-Loop Project Overrides',
      'Precedence: live header text.',
      '<!-- Based on: auto-loop.md @ abc1234 -->',
      '## Tier',
      '<!-- standard -->',
      heading,
    ].join('\n');
    assert.equal(hasActiveOverrides(headingForm), true,
      `${heading}: the heading itself carries the value, so it is an active override`);
  }

  // …and the dormant counterpart must still read as inactive, or the precondition means nothing.
  const bareHeadings = [
    '# Auto-Loop Project Overrides',
    'Precedence: live header text.',
    '## Tier',
    '<!-- standard -->',
    '## Plan Review',
    '<!-- ## Plan Review: enabled -->',
  ].join('\n');
  assert.equal(hasActiveOverrides(bareHeadings), false,
    'bare scaffold headings with commented example values are empty slots, not overrides');
});

test('check #1 when specified → the base file is derived from the Based-on comment, never hard-coded', () => {
  // R8 ships testing-project.md too. A hard-coded auto-loop.md comparand would read a testing
  // override's recorded hash and compare it against a different rule — guaranteed false drift.
  const section = s25(skill);
  assert.match(section, /derive the base file from the comment's own filename/,
    'derivation is stated');
  assert.match(section, /must not be hard-coded/, 'the anti-pattern is named explicitly');
  assert.match(section, /testing-project\.md/, 'the second shipped template is named as the reason');
  const row1 = section.split('\n').find((l) => /^\| 1 \|/.test(l));
  assert.match(row1, /derived, never hard-coded/, 'the check table row carries it too, not just the prose');
});

test('check #3 when specified → covers every shipped override file and a missing derived base', () => {
  // Routing "derived base missing" to check #3 is only honest if #3 actually detects it. As
  // originally written #3 checked one file's CLAUDE.md reference pairing and nothing else, so an
  // active testing-project.md whose testing.md had been deleted fell through BOTH checks: #1
  // deferred to #3, and #3 never looked.
  const section = s25(skill);
  const row3 = section.split('\n').find((l) => /^\| 3 \|/.test(l));
  assert.ok(row3, 'check #3 row must exist');
  assert.match(row3, /Missing reference or base/, 'the check owns the missing-base branch by name');
  for (const f of ['auto-loop-project.md', 'testing-project.md']) {
    assert.ok(row3.includes(f), `check #3 must enumerate ${f} — one-file coverage is what created the gap`);
  }
  assert.match(row3, /the base rule its `Based on:` comment names is missing/,
    'the missing-base condition is stated as a detection, not an aspiration');
  assert.match(section, /report it through check #3's \*\*missing base\*\* branch/,
    'check #1 hands off to a branch that exists');
  assert.match(section, /would otherwise fall through both/,
    'the failure mode is recorded so the coupling is not undone later');
});
