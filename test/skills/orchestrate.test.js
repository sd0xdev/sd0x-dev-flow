const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

const root = resolve(__dirname, '../..');
const skillDir = resolve(root, 'skills/orchestrate');
const skillPath = resolve(skillDir, 'SKILL.md');

// Hook-parsed sentinels that /orchestrate output (and its own docs) must never recite.
const HOOK_SENTINELS = ['## Gate:', '✅ Ready', '✅ Mergeable', '⛔ Blocked', '✅ All Pass'];

/**
 * Read one frontmatter key's ACTIVE value — full multi-line value, YAML comments removed.
 *
 * Both halves matter and each fixes a distinct wrong answer:
 *
 *   - Whole value, no `m` flag. `allowed-tools` is inline today but YAML permits a block list, and
 *     `/^allowed-tools:.*$/m` would then capture only the empty header — entitlements on
 *     continuation lines invisible, so a `doesNotMatch` passes vacuously against a file that DOES
 *     declare the thing. With the `m` flag `$` matches at every line end and the lookahead
 *     terminates the capture on line 1, reintroducing exactly that.
 *   - Comments stripped. A raw substring test cannot tell a live entitlement from a disabled one:
 *     `#  - AskUserQuestion` satisfied a positive assertion while granting nothing (fail-open),
 *     and a note like `# Skill is deliberately omitted` would trip a negative assertion on a file
 *     that is correct (fail-closed-but-wrong). Both are the same defect — matching text the YAML
 *     parser never sees.
 *
 * `#` opens a comment only at line start or after whitespace, and never inside a quoted scalar —
 * so a value like `a#b` or `"x # y"` survives intact.
 */
function frontmatterValue(fm, key) {
  const m = fm.match(new RegExp(`(?:^|\\n)${key}:([\\s\\S]*?)(?=\\n[A-Za-z_-]+:|$)`));
  if (!m) return null;
  return m[0]
    .split('\n')
    .map((line) => {
      let out = '';
      let quote = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
          out += c;
          if (c === quote) quote = null;
          continue;
        }
        if (c === "'" || c === '"') { quote = c; out += c; continue; }
        if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
        out += c;
      }
      return out;
    })
    .join('\n');
}

test('frontmatterValue reads the whole value and ignores commented-out entitlements', () => {
  const fm = [
    'name: demo',
    'allowed-tools:',
    '  - Read',
    '  #  - AskUserQuestion',
    '  - Grep  # kept for the fanout probe',
    'description: x',
  ].join('\n');

  const v = frontmatterValue(fm, 'allowed-tools');
  assert.match(v, /\bRead\b/, 'block-list entries must be visible (the no-`m` capture)');
  assert.match(v, /\bGrep\b/, 'a value with a trailing comment keeps its value');
  assert.doesNotMatch(v, /AskUserQuestion/, 'a commented-out entitlement grants nothing');
  assert.doesNotMatch(v, /fanout probe/, 'trailing comment text must not be matchable either');
  assert.doesNotMatch(v, /description/, 'the capture must stop at the next top-level key');
  assert.equal(frontmatterValue(fm, 'disallowed-tools'), null, 'absent key reads as null');

  assert.match(frontmatterValue('k: a#b\n', 'k'), /a#b/, '`#` without leading space is literal');
  assert.match(frontmatterValue('k: "x # y"\n', 'k'), /x # y/, '`#` inside quotes is literal');
});

// --- SKILL.md structure assertions ---

test('orchestrate SKILL.md exists with valid frontmatter', () => {
  assert.ok(existsSync(skillPath), 'skills/orchestrate/SKILL.md should exist');
  const content = readFileSync(skillPath, 'utf8');
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fmMatch, 'should have frontmatter block');
  assert.match(fmMatch[1], /^name:\s*orchestrate/m, 'name should be orchestrate');
  assert.match(fmMatch[1], /^description:/m, 'should have description');
  // Whole value, comments stripped — see frontmatterValue for why each half is load-bearing.
  const allowedTools = frontmatterValue(fmMatch[1], 'allowed-tools');
  assert.ok(allowedTools, 'should declare allowed-tools');
  assert.match(allowedTools, /AskUserQuestion/, 'execute approval needs AskUserQuestion');
  assert.match(allowedTools, /\bTask\b/, 'fanout dispatch needs Task');
});

test('orchestrate report-only boundary is the run-verify backstop, NOT a Skill capability block', () => {
  // Codex iteration-14 P1: an unrestricted `Skill` entitlement lets an accepted
  // main-skill step invoke ANY catalog skill. validate-plan.js A4 only checks the
  // target exists and TRUSTS the planner-supplied `mutating` flag, so a lying
  // `{kind:main-skill, target:'/bug-fix', mutating:false}` passes A3+A4.
  //
  // Codex iteration-15 P1: `allowed-tools` is only a PRE-APPROVAL allowlist — tools
  // NOT listed there stay callable under the user's normal permissions, so merely
  // omitting `Skill` is not a hard block.
  //
  // Codex iteration-16 P1: `disallowed-tools: Skill` IS a hard block, but it stays
  // active until the NEXT user message (not just for the skill body), and the mandatory
  // same-turn `/codex-review-doc` handoff ALSO runs via the Skill tool — so blocking
  // Skill would kill the doc-review handoff and the run could never reach Mergeable/`done`.
  // Therefore the report-only guarantee does NOT rest on capability-blocking Skill at all.
  // The backstop is run-verify.js's SC-2 pre/post no-change proof: a BEST-EFFORT, fail-closed
  // drift check over the git-scoped MONITORED SURFACE (porcelain + tracked/untracked/ignored
  // content + tracked modes + untracked/ignored directory nodes + refs/config/worktree/stash +
  // .git hooks/info-exclude) — a mutation there (including
  // one an errant main-skill dispatch caused) drifts → run failed, no report. It is NOT an
  // absolute guarantee: excluded prefixes and index-hiding residuals are deferred to v2 (see
  // SKILL.md §Report-only 強制機制 and admission-allowlist.json residual_risk). This test pins
  // the resulting frontmatter invariants:
  //   1. `Skill` is NOT pre-approved in allowed-tools (defense-in-depth: dispatch would
  //      need explicit runtime permission), AND
  //   2. `disallowed-tools: Skill` is NOT present (it would break the doc-review handoff),
  //      AND
  //   3. the body never dispatches `Skill(` (behavior-layer: main-skill = proposed-manual).
  // Non-tautology: adding `Skill` to allowed-tools fails (1); adding `disallowed-tools: Skill`
  // fails (2); adding a `Skill(` dispatch to the body fails (3).
  const content = readFileSync(skillPath, 'utf8');
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const fm = fmMatch[1];
  // Whole value, comments stripped. Both assertions below are NEGATIVE, which is the shape that
  // fails open: a capture that stops at the header line, or that reads a `# ... Skill ...` note as
  // a declaration, gives the wrong verdict in opposite directions. See frontmatterValue.
  const allowedLine = frontmatterValue(fm, 'allowed-tools');
  assert.ok(allowedLine, 'orchestrate/SKILL.md should declare allowed-tools');
  const disallowedMatch = frontmatterValue(fm, 'disallowed-tools');
  // (1) Skill stays out of the pre-approval allowlist. Word-boundary match so a substring
  // like "SkillFoo" (none today) can't false-negative.
  assert.doesNotMatch(allowedLine, /\bSkill\b/, 'allowed-tools must NOT pre-approve the Skill entitlement (report-only v1)');
  // (2) disallowed-tools must NOT block Skill — that would kill the same-turn /codex-review-doc
  // handoff (Codex iter-16 P1).
  //
  // Asserted unconditionally. Guarding this on `if (disallowedMatch)` meant the assertion NEVER
  // RAN — the key is absent today — so invariant (2) was documented, listed in the non-tautology
  // note above, and enforced by nothing. Pinning the absent case explicitly keeps the check live
  // and makes the day someone ADDS a `disallowed-tools` line a deliberate edit to this test rather
  // than a silent re-enablement.
  if (disallowedMatch === null || disallowedMatch === undefined) {
    assert.ok(true, 'no disallowed-tools declaration → Skill is not blocked, which is the invariant');
  } else {
    assert.doesNotMatch(disallowedMatch, /\bSkill\b/, 'disallowed-tools must NOT block Skill (it would break the mandatory same-turn doc-review handoff)');
  }
  // (3) Body must NOT contain a real Skill() dispatch (behavior-layer report-only boundary).
  assert.doesNotMatch(content, /\bSkill\(/, 'orchestrate must not dispatch Skill() in v1 (doc-review handoff is behavior-layer)');
});

test('orchestrate SKILL.md has Trigger, When NOT to Use, and Flags sections', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /## Trigger/i);
  assert.match(content, /When NOT to Use/i);
  assert.match(content, /--execute/, 'should document --execute');
  assert.match(content, /--resume/, 'should document --resume');
  assert.match(content, /--budget/, 'should document --budget');
});

test('orchestrate SKILL.md documents the baseline timing invariant (snapshot before any agent)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /先於任何 agent 派發/, 'snapshot must precede any agent dispatch (incl. planner)');
  assert.match(content, /run-verify\.js snapshot/, 'should name the snapshot command');
  assert.match(content, /同一 baseline/, 'post-execute compare must reuse the same baseline');
});

test('orchestrate SKILL.md resume is fail-closed (original baseline, no re-snapshot)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /原 baseline/, '--resume must compare against the original baseline');
  assert.match(content, /needs_human/, 'drift on resume → needs_human stop');
  assert.match(content, /不得重拍 baseline/, 'must forbid re-snapshot whitewash');
});

test('orchestrate SKILL.md persists the baseline BODY to disk and keeps the digest session-only', () => {
  // --resume was advertised while the only place the baseline existed was the main session's
  // context — snapshot writes it to stdout and nothing captured it. So the flag promised a
  // capability the flow could not deliver: after any compaction the baseline bytes were gone, and
  // `compare --baseline <path>` had nothing to read. The fix splits the two halves deliberately:
  // the body goes to `.claude_workflows/<run-id>/baseline.json`, the digest stays in context.
  // That split IS the binding — a worker can read (or rewrite) the file but cannot forge the
  // digest, whereas storing the digest beside the baseline would bind nothing at all.
  const content = readFileSync(skillPath, 'utf8');

  assert.match(
    content, /baseline\.json/,
    'the snapshot body must be given a durable path, not left in the session transcript'
  );
  assert.match(
    content, /baseline_sha256[^\n]*(context|session)/,
    'the digest must be documented as session-held'
  );
  assert.match(
    content, /(絕不寫進|刻意不存)/,
    'the SKILL must state that the digest is deliberately NOT persisted next to the baseline'
  );

  // The invariant stated as a negation, which is what actually keeps the binding: no instruction
  // anywhere may route the digest into the control plane.
  const digestToDisk = content
    .split('\n')
    .filter((l) => /baseline_sha256/.test(l) && /\.claude_workflows/.test(l) && !/(絕不寫進|不存|未寫入)/.test(l));
  assert.deepEqual(
    digestToDisk, [],
    'a line routing baseline_sha256 into .claude_workflows/ would dissolve the binding'
  );
});

test('orchestrate SKILL.md output isolation: declares its own markers, never recites hook sentinels', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('## Orchestrate Run Summary'), 'should declare its run summary header');
  assert.ok(content.includes('[ORCHESTRATE_RUN]'), 'should declare its structured status line');
  for (const sentinel of HOOK_SENTINELS) {
    assert.ok(!content.includes(sentinel), `SKILL.md must not contain hook sentinel: ${sentinel}`);
  }
});

test('orchestrate skill files (docs + references) contain no hook sentinel literals (S1 self-compliance)', () => {
  const files = [
    'references/planner-prompt.md',
    'references/plan-schema.md',
    'references/execution-policy.md',
    'references/admission-allowlist.json',
  ];
  for (const rel of files) {
    const content = readFileSync(resolve(skillDir, rel), 'utf8');
    for (const sentinel of HOOK_SENTINELS) {
      assert.ok(!content.includes(sentinel), `${rel} must not contain hook sentinel: ${sentinel}`);
    }
  }
});

test('orchestrate SKILL.md two-plane separation: safety plane is read-only, run-state has no safety fields', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /\.claude_review_state\.json/, 'should name the safety plane file');
  assert.match(content, /只讀，永不寫/, 'orchestrator must be read-only on the safety plane');
  const schemaDoc = readFileSync(resolve(skillDir, 'references/plan-schema.md'), 'utf8');
  for (const field of ['code_review', 'doc_review', 'aggregate_gate']) {
    assert.ok(!content.includes(field), `SKILL.md run-state must not define safety field: ${field}`);
    assert.ok(!schemaDoc.includes(field), `plan-schema.md must not define safety field: ${field}`);
  }
});

test('orchestrate SKILL.md redaction + FIFO + done-only-via-doc-review contracts present', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /scanHighConfidence/, 'high-confidence secret scan must be named');
  assert.match(content, /abort fail-closed|abort.*fail-closed/i, 'high-confidence hit must abort, not mask');
  assert.match(content, /保留最近 10 個 run/, 'FIFO 10 retention');
  // The retention unit is the RUN, not the run-state file: `<run-id>.json` and the sibling
  // `<run-id>/` directory (packet + plan) are counted and deleted together. Sweeping only the
  // `.json` leaves every run's ~81 KB plan-context.json accumulating forever, so the pairing is
  // part of the contract, not an implementation detail.
  assert.match(content, /`<run-id>\.json`/, 'FIFO must name the run-state file');
  assert.match(content, /`<run-id>\/`/, 'FIFO must name the sibling run directory');
  assert.match(content, /一起算、一起刪|一起計數|一起刪除/, 'FIFO must state that both are swept together');
  assert.match(content, /`done` 的\*\*唯一路徑\*\*/, 'done reachable only via doc review Mergeable gate');
});

// --- Scripts and references existence ---

test('orchestrate bundles all four scripts and four references', () => {
  // Derived, not hand-listed, for the count assertion below: prune-runs.js shipped without this
  // test noticing, and the spec's own "3 個 scripts" heading stayed wrong for as long.
  for (const rel of [
    'scripts/plan-context.js',
    'scripts/validate-plan.js',
    'scripts/run-verify.js',
    'scripts/prune-runs.js',
    'references/planner-prompt.md',
    'references/plan-schema.md',
    'references/execution-policy.md',
    'references/admission-allowlist.json',
  ]) {
    assert.ok(existsSync(resolve(skillDir, rel)), `skills/orchestrate/${rel} should exist`);
  }

  // The bundle list above is hand-maintained; this pins it to what is actually on disk, so a
  // fifth script cannot ship unlisted the way the fourth did.
  const onDisk = readdirSync(resolve(skillDir, 'scripts')).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(
    onDisk,
    ['plan-context.js', 'prune-runs.js', 'run-verify.js', 'validate-plan.js'],
    'skills/orchestrate/scripts/ contents changed — update this list, the bundle list above, and '
      + 'the "N 個 scripts" heading in docs/features/workflow-orchestration/2-tech-spec.md §3.3'
  );
});

test('the tech spec\'s script count matches what the skill actually bundles', () => {
  const spec = readFileSync(resolve(root, 'docs/features/workflow-orchestration/2-tech-spec.md'), 'utf8');
  const n = readdirSync(resolve(skillDir, 'scripts')).filter((f) => f.endsWith('.js')).length;
  assert.match(
    spec, new RegExp(`### 3\\.3 API Design（${n} 個 scripts`),
    `§3.3 must say ${n} scripts — the heading said 3 while 4 were bundled`
  );
});

// --- Admission allowlist lock ---

test('admission allowlist is locked to Explore + performance-optimizer with documented exclusions', () => {
  const allowlist = JSON.parse(readFileSync(resolve(skillDir, 'references/admission-allowlist.json'), 'utf8'));
  assert.equal(allowlist.mode, 'deny-by-default');
  assert.deepEqual(
    allowlist.fanout_allowlist.map((e) => e.name).sort(),
    ['Explore', 'performance-optimizer'],
    'v1 allowlist is exactly these two entries'
  );
  const excluded = allowlist.explicit_exclusions.map((e) => e.name);
  assert.ok(excluded.includes('coverage-analyst'), 'coverage-analyst exclusion must be recorded');
  assert.ok(excluded.includes('git-investigator'), 'git-investigator exclusion must be recorded');
  for (const entry of allowlist.explicit_exclusions) {
    assert.ok(entry.reason && entry.reason.length > 0, `exclusion ${entry.name} must carry a reason`);
  }
});

test('admission allowlist expected_tools matches the live agent frontmatter (drift lock)', () => {
  const allowlist = JSON.parse(readFileSync(resolve(skillDir, 'references/admission-allowlist.json'), 'utf8'));
  for (const entry of allowlist.fanout_allowlist.filter((e) => e.type === 'repo-agent')) {
    const agentFile = resolve(root, 'agents', `${entry.name}.md`);
    assert.ok(existsSync(agentFile), `agents/${entry.name}.md should exist`);
    const toolsLine = readFileSync(agentFile, 'utf8').split('\n').find((l) => l.startsWith('tools:'));
    assert.equal(
      toolsLine.replace(/^tools:\s*/, '').trim(),
      entry.expected_tools,
      `agents/${entry.name}.md tools must equal allowlist expected_tools — re-review admission on change`
    );
  }
});

// --- Control plane gitignore ---

test('.claude_workflows/ run-state files are gitignored (control plane never enters the repo)', () => {
  const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.claude_workflows\/$/m, '.gitignore should list .claude_workflows/');
  let status = 0;
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '-q', '.claude_workflows/20260612-000000-sample.json']);
  } catch (err) {
    status = err.status;
  }
  assert.equal(status, 0, 'git check-ignore should confirm run-state paths are ignored');
});

// --- Registration assertions ---

test('orchestrate is registered in docs/skill-catalog.yml under planning', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /command: \/orchestrate/, 'catalog should list /orchestrate');
});

// Registration lives solely in docs/skill-catalog.yml (asserted above) — the CLAUDE.md
// command table was removed in R3 (auto-loop prose reduction).

// --- Doc ↔ code agreement ---

/**
 * Extract every top-level key of an object-literal body, fail-closed.
 *
 * Two rounds of the same fail-open have gone through here, both because the parser processed less
 * than the line it was handed and reported nothing about the remainder:
 *
 *   1. `^ {6}([a-z0-9_]+)\s*[:,]` SKIPPED any line it did not match, so `...extraSignals,` and
 *      `'sub-modules': 1,` added real comparison fields with the test still green.
 *   2. The line-anchored replacement recognised the FIRST key on a line and dropped the rest, so
 *      `head, extraSignals,` — a perfectly ordinary shorthand run, and how these literals are
 *      actually written — silently contributed one field instead of two.
 *
 * So this splits on depth-0 commas (quote- and bracket-aware) and demands that EVERY resulting
 * segment be a recognisable key. A segment it cannot name goes to `unrecognised`, which the caller
 * asserts empty — narrowing scope is never silent.
 *
 * `indent` is the exact leading width of a top-level property; deeper lines are inside a value. It
 * is DERIVED from the body by default rather than fixed at 6. A hard-coded width made formatting a
 * silent scope limit: `if (!top.test(line)) continue` skipped every line that did not sit at
 * exactly six spaces, and those skips bypassed `unrecognised` entirely — so re-indenting the
 * literal (a nesting change, a prettier pass, an `if` wrapped around it) would empty the parse and
 * the caller's set-equality assertion would compare two empty sets and pass. The one thing this
 * function promises is that narrowing scope is never silent; deriving the width is what makes that
 * promise survive a reformat.
 */
/**
 * Split an object-literal body into its TOP-LEVEL segments and name each one's key.
 *
 * Indentation plays no part in the classification, and that is the point. The previous version
 * decided "top level" by leading width — first hard-coded at 6, then derived as the body's minimum
 * — and in both forms `if (!top.test(line)) continue` SKIPPED anything at another width without
 * routing it through `unrecognised`. Deriving the minimum fixed a uniformly re-indented literal but
 * not the case that actually shows up in review: one new property indented more deeply than its
 * siblings, which then contributed nothing and was reported nowhere. A literal with `head` and
 * `branch` at six spaces and `undocumented_signal` at eight parsed as `{emitted: ['head','branch'],
 * unrecognised: []}` — a silent scope limit in the one function whose entire promise is that
 * narrowing scope is never silent.
 *
 * Bracket depth is the structural fact that indentation only approximates, and it survives any
 * reformat: a `,` at depth 0 separates properties, everything else belongs to the value it sits
 * inside. So the body is scanned as one character stream — quote-, escape-, bracket- and
 * comment-aware — and split on depth-0 commas across line boundaries. Every resulting segment must
 * be nameable; one that is not goes to `unrecognised`, which the caller asserts empty.
 */
function parseObjectLiteralKeys(body) {
  const segments = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += body[i + 1] ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '/' && body[i + 1] === '/') {                    // line comment → drop to the newline
      while (i < body.length && body[i] !== '\n') i++;
      cur += '\n';
      continue;
    }
    if ('([{'.includes(c)) { depth++; cur += c; continue; }
    if (')]}'.includes(c)) {
      if (depth === 0) break;                                  // the literal's own closer
      depth--;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) { segments.push(cur); cur = ''; continue; }
    cur += c;
  }
  segments.push(cur);

  const emitted = [];
  const unrecognised = [];
  for (const raw of segments) {
    const part = raw.trim();
    if (part === '') continue;                                 // trailing comma / blank line
    // `key:` (value owns the rest of the segment) or bare `key` shorthand.
    const m = part.match(/^(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))(?:\s*:|$)/);
    if (m) emitted.push(m[1] ?? m[2] ?? m[3]);
    else unrecognised.push(part);
  }
  return { emitted, unrecognised };
}

test('parseObjectLiteralKeys names every key on a line, and refuses what it cannot name', () => {
  // The parser is the thing the baseline test trusts, so its blind spots are the baseline test's
  // blind spots. Pinned here directly rather than hoping a future run-verify.js happens to use
  // each shape.
  const all = (body) => parseObjectLiteralKeys(body);

  assert.deepEqual(all('      head, branch, worktrees,').emitted, ['head', 'branch', 'worktrees'],
    'a shorthand run must contribute EVERY key, not just the first');

  assert.deepEqual(all("      porcelain_sha256: sha256(a, b),\n      'sub-modules': 1,").emitted,
    ['porcelain_sha256', 'sub-modules'],
    'a comma inside a call argument list is not a property separator');

  assert.deepEqual(all('      note: "a, b",').emitted, ['note'],
    'a comma inside a string is not a property separator');

  assert.deepEqual(all('      files: build(repo, {\n        deep: 1,\n      }),\n      head,').emitted,
    ['files', 'head'], 'a multi-line value is consumed, and the property after it is still seen');

  assert.deepEqual(all('      ...extraSignals,').unrecognised, ['...extraSignals'],
    'a spread cannot be matched against the doc — it must be reported, not skipped');
  assert.deepEqual(all('      [computed]: 1,').unrecognised, ['[computed]: 1'],
    'a computed key likewise');

  assert.deepEqual(all('      head, // the resolved sha\n').emitted, ['head'],
    'a trailing comment is not a key');

  // Indentation is FORMATTING, not syntax. With the width hard-coded at 6, a re-indented literal
  // matched no line, every line was skipped by the `continue` that bypasses `unrecognised`, and the
  // caller compared an empty emitted set against an empty documented set — green, having read
  // nothing. These two assert the same keys at two different widths.
  assert.deepEqual(all('    head, branch,').emitted, ['head', 'branch'],
    'a four-space literal must parse identically — reformatting is not a scope change');
  assert.deepEqual(all('        head, branch,').emitted, ['head', 'branch'],
    'and an eight-space one likewise');
  assert.deepEqual(all('    ...extraSignals,').unrecognised, ['...extraSignals'],
    'and the refusal path must survive the reformat too, or the skip becomes silent again');

  // The case a MINIMUM-width heuristic still missed: siblings agree on a width and one new property
  // does not. Deriving the width made the literal's own baseline correct and left the outlier
  // invisible — added field, unchanged parse, green test. Depth, not indentation, decides.
  assert.deepEqual(
    all('      head,\n      branch,\n        undocumented_signal,').emitted,
    ['head', 'branch', 'undocumented_signal'],
    'a top-level property indented differently from its siblings is still a top-level property'
  );
  assert.deepEqual(
    all('      head,\n        ...lateSpread,').unrecognised,
    ['...lateSpread'],
    'and an unnameable one at an odd width must be REPORTED, not skipped'
  );

  // The complement: a genuinely nested key must NOT be promoted just because depth is now the
  // criterion. Without this, "treat every line as top level" would also pass the assertions above.
  assert.deepEqual(
    all('      files: {\n        inner_key: 1,\n      },\n      head,').emitted,
    ['files', 'head'],
    'keys inside a value belong to that value, whatever column they are written at'
  );
});

test('the tech-spec baseline block documents EXACTLY the snapshot field set', () => {
  // The spec calls this field set "欄位集 = T3 檢查項，缺一不可", so a documented baseline that omits
  // a field is not a cosmetic gap: a baseline built to the doc is REJECTED. Two ways —
  // `compare` reports drift for a field the reader was never told to produce, and a missing
  // `schema_version` trips the hard cross-schema refusal at run-verify.js — an omitted field reads
  // as `undefined`, which never equals the emitted version whatever that version currently is.
  // (Written as a literal `undefined !== 3` until 2026-07-26, which went stale the moment the
  // schema moved to 4; the version number was never the point, so it is no longer written down.)
  // The block had drifted both ways: `ignored_content_sha256` / `ignored_dirs_sha256` were added as
  // compared fields (they catch gitignored-file edits and empty ignored directories, both invisible
  // to porcelain AND to `ls-files --exclude-standard`) and `schema_version` was never documented at
  // all. Asserting SET EQUALITY over the FULL emitted record, so a field removed from the code also
  // fails here.
  const src = readFileSync(resolve(skillDir, 'scripts/run-verify.js'), 'utf8');

  const snapBody = src.match(/function snapshot\(repo\)[\s\S]*?\n    return \{\n([\s\S]*?)\n    \};/);
  assert.ok(snapBody, 'run-verify.js should declare snapshot() returning an object literal');

  const { emitted, unrecognised } = parseObjectLiteralKeys(snapBody[1]);
  assert.deepEqual(
    unrecognised, [],
    'unparseable field in snapshot() — a spread or computed key cannot be checked against the doc; '
      + 'expand it into named fields, or teach this parser about it deliberately'
  );
  assert.ok(emitted.length > 0, 'snapshot() should emit fields');

  const doc = readFileSync(resolve(root, 'docs/features/workflow-orchestration/2-tech-spec.md'), 'utf8');
  const start = doc.indexOf('"baseline": {');
  const end = doc.indexOf('"plan": {', start);
  assert.ok(start !== -1 && end > start, 'tech-spec should contain the run-state baseline block');
  const block = doc.slice(start, end);
  // Char class mirrors the code side. A narrower one here would re-open the same fail-open: a field
  // the code emits but this regex cannot see would look "undocumented" in both places at once.
  const documented = (block.match(/"([A-Za-z0-9_-]+)":/g) || [])
    .map((q) => q.slice(1, -2))
    .filter((k) => k !== 'baseline');

  assert.deepEqual(
    [...emitted].sort(),
    [...documented].sort(),
    'the documented baseline schema and the emitted snapshot fields must be the same set'
  );
});

test('the baseline doc marks schema_version as hard-validated, not drift-compared', () => {
  // The two live in the same JSON block but are checked by different mechanisms, and conflating
  // them is how the field went undocumented in the first place: `compare()` derives its field list
  // from the live snapshot MINUS COMPARE_EXCLUDED_FIELDS, and `schema_version` is the one exclusion
  // — not because it does not matter, but because a mismatch is a hard refusal before comparison
  // even starts. A reader told only "缺一不可" would reasonably expect it in the drift list.
  const src = readFileSync(resolve(skillDir, 'scripts/run-verify.js'), 'utf8');
  const excludedDecl = src.match(/const COMPARE_EXCLUDED_FIELDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(excludedDecl, 'run-verify.js should declare COMPARE_EXCLUDED_FIELDS');
  const excluded = (excludedDecl[1].match(/'([^']+)'/g) || []).map((q) => q.slice(1, -1));
  assert.deepEqual(excluded, ['schema_version'], 'only schema_version is excluded from drift comparison');

  assert.match(
    src,
    /baseline\.schema_version !== current\.schema_version/,
    'the exclusion is only safe because the caller refuses a cross-schema comparison outright'
  );

  const doc = readFileSync(resolve(root, 'docs/features/workflow-orchestration/2-tech-spec.md'), 'utf8');
  const start = doc.indexOf('"baseline": {');
  const block = doc.slice(start, doc.indexOf('"plan": {', start));
  assert.match(block, /"schema_version"/, 'the baseline block must document schema_version');
  assert.match(block, /不列入 drift 比對/, 'and must say it is not drift-compared');
});
