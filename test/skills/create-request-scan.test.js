const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { sectionAt, liveText, tableCells } = require('../helpers/markdown-structure.js');
const {
  parseRequestStatus,
  HEAD_LINES,
  CLOSED_REQUEST_STATUS,
} = require('../../scripts/lib/request-status.js');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/create-request/SKILL.md');

// Philosophy of this suite: test what EXECUTES. The doc's regexes are compiled and run, its
// recipes are run in fixture repos, its counts are measured against the real ticket corpus, and
// the parser it delegates to is exercised directly. Whether the surrounding prose still says the
// right thing is doc review's job — an earlier incarnation of this suite tried to pin prose with
// digests and sentence equality, and turned every legitimate edit into a hash-updating chore
// without making the documents more true.

// --- Basic structure -----------------------------------------------------------------------

test('create-request SKILL.md has Scan Mode Workflow section', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Scan Mode Workflow/, 'should have Scan Mode Workflow section');
});

test('create-request SKILL.md modes table has scan row', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /scan.*--status/i, 'should have scan mode with --status trigger');
});

test('create-request SKILL.md has stale detection (30 days)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /30 days/i, 'should mention 30 days stale threshold');
});

test('create-request SKILL.md documents all three metadata formats', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Blockquote/i, 'should document blockquote format');
  assert.match(content, /[Tt]able/, 'should document table format');
  assert.match(content, /Heading/i, 'should document heading format');
});

// --- Shared readers ------------------------------------------------------------------------
//
// `sectionAt` is fence-aware and uniqueness-enforcing; `liveText` blanks fenced and commented
// spans, applied to the WHOLE document before slicing so comment state is not lost.
const liveSection = (c, name, level = 3) => sectionAt(liveText(c), level, name);
const metadataSection = (c) => liveSection(c, 'Phase 2: Metadata Parsing');
const freezeSection = (c) =>
  liveSection(c, 'Phase 4.5: Freeze — a request ticket is a record, not a living document');
const PHASE25 = 'Phase 2.5: AC Verification Agent (`--verify-ac` only)';
// Prose is read masked; the agent prompt legitimately lives inside a fence, so its reader
// preserves fences and returns only the `Agent({…})` body — exactly one.
const phase25Section = (c) => liveSection(c, PHASE25);
const phase25Prompt = (c) => {
  const sec = sectionAt(liveText(c, { fencesCount: true }), 3, PHASE25);
  const bodies = [...sec.matchAll(/```[a-z]*\n([\s\S]*?)\n```/g)]
    .map((m) => m[1])
    .filter((body) => body.trimStart().startsWith('Agent({'));
  assert.equal(bodies.length, 1,
    `Phase 2.5 must carry exactly one live Agent({ … }) prompt, found ${bodies.length}`);
  return bodies[0];
};

/** The row of the metadata table whose first cell is `name`. */
const tableRow = (sec, name) =>
  sec.split('\n').find((l) => new RegExp(`^\\|\\s*${name}\\s*\\|`).test(l)) || '';
/** The first backticked span in a row — for the metadata table that is the pattern cell. */
const patternCell = (row) => (row.match(/`([^`]+)`/) || [])[1] || '';

/** The revspec the Phase 2.5 recipe tells a verifier to run — extracted, not restated, so the
 * behavioral test below executes the DOCUMENTED command. Exactly one such line must exist. */
const documentedRevspec = (sec) => {
  const hits = sec.split('\n')
    .map((l) => (l.match(/^\s*git show (\S+)\s*\|/) || [])[1]).filter(Boolean);
  assert.equal(hits.length, 1, `Phase 2.5 must document exactly one \`git show … |\` line, found ${hits.length}`);
  return hits[0];
};

// --- Parser: the documented forms are executed ---------------------------------------------

test('the documented Heading form compiles and matches what the parser matches', () => {
  const sec = metadataSection(readFileSync(skillPath, 'utf8'));
  const cell = patternCell(tableRow(sec, 'Heading'));
  assert.ok(cell, 'the Heading row must publish a pattern');
  const re = new RegExp(cell.replace('<value>', '(.+)'));
  assert.ok(re.test('## Status: Completed') && re.test('###### Status: Done'),
    'the documented pattern must accept the forms the parser accepts');
  assert.ok(!re.test('## PreStatus: Completed') && !re.test('## State: Completed'),
    'and must not accept a different field that merely contains the word');
  // The parser itself agrees.
  assert.equal(parseRequestStatus('# T\n\n## Status: Completed\n'), 'Completed');
});

test('the documented Blockquote and Table forms agree with the parser', () => {
  const sec = metadataSection(readFileSync(skillPath, 'utf8'));
  const CORPUS = ['Completed', 'In Progress', 'Candidate Complete', 'Superseded'];

  const bqForm = patternCell(tableRow(sec, 'Blockquote'));
  assert.ok(bqForm.includes('<value>'), `the Blockquote row needs a value slot: ${bqForm}`);
  for (const value of CORPUS) {
    assert.equal(parseRequestStatus(`# T\n\n${bqForm.replace('<value>', value)}\n`), value,
      `the documented Blockquote form must resolve ${value}`);
  }

  // The Table row publishes a /…/flags expression. Compile it and check it agrees with the
  // parser's behaviour over a corpus that includes near-misses (`State`, `PreStatus`) and rows
  // deep in a document (so a dropped `m` flag shows up).
  const tableCell = patternCell(tableRow(sec, 'Table'));
  const parts = tableCell.match(/^\/(.*)\/([a-z]*)$/);
  assert.ok(parts, `the Table row must publish a compilable /…/flags expression, got ${tableCell}`);
  const tableRe = new RegExp(parts[1], parts[2]);
  const ROWS = [
    ...CORPUS.map((v) => `| Status | ${v} |`),
    ...CORPUS.map((v) => `| Status | **${v}** |`),
    '| Status | Design |',
    '| status | Completed |',
    '|Status|Completed|',
    '| State | Completed |',
    '| PreStatus | Completed |',
    '| Status Note | Completed |',
    '| Status ||',
    '| Status | Completed',
  ];
  for (const row of ROWS) {
    const doc = `# T\n\n| Field | Value |\n|---|---|\n${row}\n`;
    assert.equal(tableRe.test(doc), parseRequestStatus(doc) !== null,
      `the published expression disagrees with parseRequestStatus() on: ${row}`);
  }
});

test('prose mentioning Status is not read as a Status field', () => {
  assert.equal(parseRequestStatus('# T\n\nThe Status: Completed convention is described below.\n'), null);
  assert.equal(parseRequestStatus('# T\n\nNo metadata here at all.\n'), null);
});

test('SKILL.md states the scan window the module actually uses', () => {
  const sec = metadataSection(readFileSync(skillPath, 'utf8'));
  assert.match(sec, new RegExp(`\\*\\*${HEAD_LINES}\\*\\* lines`), 'should state HEAD_LINES');
  assert.ok(!/first 15 lines/.test(sec), 'the stale 15-line window must not survive');
});

test("the git evidence probe keeps git's exit status", () => {
  // `git log … | head -5` reports head's status — 0 even when git exits 128 — so a non-repository
  // and a genuine "no commits" were indistinguishable and the tri-state collapsed. The fence must
  // limit on git itself.
  const content = readFileSync(skillPath, 'utf8');
  const fenced = sectionAt(liveText(content, { fencesCount: true }), 3, 'Phase 2: Git Verification')
    .match(/```bash\n([\s\S]*?)\n```/);
  assert.ok(fenced, 'Phase 2 must carry its probe as a bash fence');
  assert.ok(!/git log[^\n]*\|\s*head/.test(fenced[1]), 'the probe must not pipe git into head');
  assert.match(fenced[1], /git log -5 --oneline --all/, 'it must limit on git itself');
});

// --- Gate classifier: the published regex is compiled and run ------------------------------

const CLASSIFIER = 'Quality-Gate AC Classifier';
// Bare names: the published regex shares one leading `/` across the alternation.
const GATES = [
  'codex-review-fast', 'codex-review-doc', 'codex-review',
  'precommit-fast', 'precommit', 'pr-review',
];

/** Compile the classifier regex the doc publishes, so the tests run the documented rule. */
function gateMatcher(content) {
  const sec = sectionAt(liveText(content, { fencesCount: true }), 3, CLASSIFIER);
  const fences = [...sec.matchAll(/```regex\n([\s\S]*?)\n```/g)];
  assert.equal(fences.length, 1, `the classifier must publish exactly one live regex, found ${fences.length}`);
  return new RegExp(fences[0][1], 'i');
}

test('Scan Mode AC Progress delegates to the one classifier', () => {
  const content = readFileSync(skillPath, 'utf8');
  const sec = metadataSection(content);
  assert.match(sec, /excluding gate receipts/, 'AC Progress must carry the exclusion directive');
  assert.ok(sec.includes(CLASSIFIER), 'and must delegate rather than restate a list');
  const pattern = gateMatcher(content).source;
  for (const gate of GATES) {
    assert.ok(pattern.includes(gate), `the classifier's regex should cover ${gate}`);
  }
});

// Receipt semantics, not command position: an AC whose subject is real work must survive naming a
// gate command, and a plain unbolded receipt must not.
test('the gate classifier recognises receipts, not command position', () => {
  const re = gateMatcher(readFileSync(skillPath, 'utf8'));

  for (const receipt of [
    'Pass /codex-review-doc（✅ Mergeable）',
    'Pass `/codex-review-fast` → `/precommit`',
    '`/codex-review-doc` 通過',
    '**AC-Q1** Pass /codex-review-fast — round 27 ⛔ Blocked',
    'Pass /precommit',
    '`/codex-review-fast` round 1 — ⛔ Blocked, 2 × P2, both fixed',
    '`/codex-review-doc` pass',
    '`/precommit-fast` pass (214 tests, 0 errors)',
    '`/codex-review-fast` re-review after the round-2 fixes — round 3, ⛔ Blocked, 2 × P2',
    '`/precommit` — ✅ PASS (comment_blocks, lint:fix, build, test)',
    '`/precommit` after this revision — superseded by round 22 finding new blocking issues',
    '`/codex-review-doc` on this revision — same, tracked below',
    '`/precommit` — pending Codex round 30 verdict',
  ]) {
    assert.ok(re.test(receipt), `should be excluded as a gate receipt: ${receipt}`);
  }

  for (const substantive of [
    '`/precommit` — Try script -> fallback + graceful skip + intent frontmatter + ecosystem detection',
    '`/precommit-fast` — Try script -> fallback + graceful skip + intent frontmatter + ecosystem detection',
    '`/pr-review` 整合：自動呼叫 fast mode，High+ 時觸發 deep',
    '`review_mode=dual` 時，Stop 回報的事實為待決聚合義務，且不含 `/codex-review-fast`',
    '`test/hooks/x.test.js` 新增 10 個測試（precedence、`/precommit` 路由、sentinel）',
    'Skill routing：支援至少 8 個 route target（`/feature-dev`、`/codex-review-fast`）',
    '警告內容列出缺失的 gate 與對應指令——範例區塊含 `/precommit-fast`、`/precommit`',
    '提供 copy-pasteable 修正指令（如 `/codex-review-fast`）',
    '`/precommit` runner 支援 ecosystem 偵測 — ✅ 已驗證',
    '`/precommit` must queue work while a build is pending, then resume',
  ]) {
    assert.ok(!re.test(substantive), `should stay substantive: ${substantive}`);
  }
});

// The classifier is anchored to the corpus that motivated it: these ACs are read back out of the
// real tickets, so the rule cannot drift while inline fixtures keep passing.
test('the classifier fixtures match the real ACs they were taken from', () => {
  const re = gateMatcher(readFileSync(skillPath, 'utf8'));
  const acAt = (rel, needle) => {
    const line = readFileSync(resolve(root, rel), 'utf8')
      .split('\n')
      .find((l) => /^\s*[-*]\s*\[[ xX]\]/.test(l) && l.includes(needle));
    assert.ok(line, `${rel} should still contain an AC matching ${needle}`);
    return line.replace(/^\s*[-*]\s*\[[ xX]\]\s*/, '');
  };

  assert.ok(!re.test(acAt(
    'docs/features/plugin-testing-generalization/requests/2026-02-01-plugin-testing-and-generalization.md',
    'Try script',
  )), 'an implementation requirement for /precommit must stay substantive');
  assert.ok(re.test(acAt(
    'docs/features/harness-engineering-rebrand/requests/2026-04-12-harness-engineering-rebrand.md',
    'AC-8: Pass',
  )), 'a plain-labelled receipt must be excluded as a gate AC');
  assert.ok(re.test(acAt(
    'docs/features/bug-fix-redesign/requests/2026-03-18-bug-fix-redesign.md',
    '`/codex-review-doc` pass',
  )), 'a lowercase-pass receipt must be excluded as a gate AC');
  assert.ok(re.test(acAt(
    'docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md',
    'round-2 fixes — round 3',
  )), 'a receipt whose verdict tail sits past the dash must be excluded');
  assert.ok(re.test(acAt(
    'docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md',
    'superseded by round 22',
  )), 'a gate AC recording that its gate was superseded must be excluded');
});

// --- AC extraction -------------------------------------------------------------------------

// The published extractor shape (§ Live Checkbox ACs). The `{0,3}` indent bound is load-bearing:
// deeper indent under a paragraph is a continuation, not an AC.
const AC_ITEM = /^ {0,3}-\s+\[( |x|X)\]\s*(.*)$/;

test('the AC extractor counts top-level live task-list items only', () => {
  const count = (body) =>
    liveText(`# T\n\n## Acceptance Criteria\n\n${body}\n`).split('\n').filter((l) => AC_ITEM.test(l)).length;

  assert.equal(count('- [x] a real AC'), 1, 'a top-level task-list item counts');
  assert.equal(count('```markdown\n- [x] fenced example\n```'), 0, 'a fenced example does not');
  assert.equal(count('<!--\n- [x] commented example\n-->'), 0, 'a commented example does not');
  assert.equal(count('Example only:\n    - [x] illustrative checkbox'), 0,
    'an indented continuation does not');

  // Why the preflight refuses mixed syntax rather than checking for an empty parse: `- [x] done`
  // beside `* [ ] not done` parses to ONE item, all checked — the unchecked AC does not fail the
  // check, it disappears, and the ticket would promote with outstanding work.
  const MIXED = '## Acceptance Criteria\n\n- [x] done\n* [ ] not done\n';
  const items = [...liveText(MIXED).split('\n').map((l) => l.match(AC_ITEM)).filter(Boolean)];
  assert.equal(items.length, 1, 'the supported grammar parses only the hyphen item…');
  assert.ok(items.every((m) => m[1].toLowerCase() === 'x'),
    '…and every parsed item is checked, so an empty-set test cannot catch this section');
});

// --- Phase 2.5: verification of deleted subjects -------------------------------------------

test('verify-ac treats a deleted subject as complete-later-removed, never a downgrade', () => {
  const raw = readFileSync(skillPath, 'utf8');
  const prose = phase25Section(raw);
  assert.match(prose, /Complete \(later removed\)/, 'should define the later-removed status');
  assert.match(prose, /never `Not Found`, and never a downgrade/, 'should state the prohibition');

  const prompt = phase25Prompt(raw);
  assert.match(prompt, /--diff-filter=D/, 'the prompt should show how to find the removing commit');
  assert.match(
    prompt,
    /Status: Complete \| Complete \(later removed\) \| Partial \| Not Found \| Inconclusive/,
    'Not Found must remain a legal verdict in the agent contract',
  );
});

// The recipe is executable, so it is tested by EXECUTING THE DOCUMENTED COMMAND in a throwaway
// repo — the revspec is extracted from the doc, so dropping the `^` fails this test.
test('the documented history recipe reads the deletion commit PARENT, and that works', () => {
  const revspec = documentedRevspec(phase25Prompt(readFileSync(skillPath, 'utf8')));

  const dir = mkdtempSync(join(tmpdir(), 'req-history-'));
  try {
    // Ambient git state is dropped wholesale: an exported GIT_DIR would redirect the commits below
    // into the CALLER'S repository. Same fence as test/skills/remind.test.js.
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
    env.HOME = dir;
    env.XDG_CONFIG_HOME = join(dir, '.config');
    env.GIT_CONFIG_NOSYSTEM = '1';
    env.GIT_TERMINAL_PROMPT = '0';

    const git = (...args) => {
      const r = spawnSync(
        'git',
        ['-C', dir, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args],
        { env, encoding: 'utf8' },
      );
      assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
      return r.stdout.trim();
    };
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    // The load-bearing check is the OBJECT DATABASE: `--show-toplevel` still answers with the
    // fixture under a redirected GIT_DIR; `--absolute-git-dir` reports the redirection.
    assert.equal(
      realpathSync(git('rev-parse', '--absolute-git-dir')),
      realpathSync(join(dir, '.git')),
      'fixture git commands must write to the fixture object database',
    );
    const file = 'hooks/retired-hook.sh';
    mkdirSync(join(dir, 'hooks'), { recursive: true });
    writeFileSync(join(dir, file), '#!/bin/sh\necho marker-line\n');
    git('add', '-A');
    git('commit', '-qm', 'add the hook');
    rmSync(join(dir, file));
    git('add', '-A');
    git('commit', '-qm', 'delete the enforcement-layer machine');

    const deletion = git('log', '--diff-filter=D', '--format=%h', '-1', '--', file);
    assert.ok(deletion, 'the fixture repo should report a deletion commit');

    const resolved = revspec.replace('<deletion-commit>', deletion).replace('<path>', file);
    const documented = spawnSync('git', ['-C', dir, 'show', resolved], { env, encoding: 'utf8' });
    assert.equal(documented.status, 0, `the documented revspec must resolve: git show ${resolved}`);
    assert.match(documented.stdout, /marker-line/, 'and must return the deleted file content');

    // The negative control: without the `^` the same lookup fails — that is why it is documented.
    const unparented = spawnSync('git', ['-C', dir, 'show', `${deletion}:${file}`], { env });
    assert.notEqual(unparented.status, 0, 'the unparented form must fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- The decision table, parsed as the machine it is ---------------------------------------
//
// This table produced blocking findings in three consecutive review rounds (overlapping rows,
// verdicts grouped with confidences, validity below the verdict rules), so it is the one piece of
// prose this suite still parses and compares exactly: it is an ordered decision procedure an agent
// executes, not narrative.

const LIFECYCLE = ['Pending', 'In Progress', 'Candidate Complete', 'Completed'];

const EXPECTED_RULES = [
  [1, 'report validity', 'The report is empty, unparseable or unaccounted for, **and** any AC is unchecked', 'In Progress'],
  [2, 'report validity', 'The report is empty, unparseable or unaccounted for, and every AC is checked', 'Candidate Complete'],
  [3, 'verdicts', 'Any AC `Partial` or `Not Found`', 'In Progress'],
  [4, 'verdicts', 'Any AC `Inconclusive` on an **unchecked** AC', 'In Progress'],
  [5, 'verdicts', 'Any remaining `Inconclusive` (on an already-checked AC), or any confidence below `High`', 'Candidate Complete'],
  [6, 'verdicts', 'Every AC is `Complete` or `Complete (later removed)` at `High`', 'Completed'],
];

/** Parse the numbered decision table into `{ n, stage, condition, status }` via the escape-aware
 * `tableCells()`. The status cell must carry exactly one lifecycle token. */
function decisionRules(sec) {
  const rows = sec.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
  return rows.map((l) => {
    const cells = tableCells(l);
    assert.ok(cells, `numbered row is not a well-formed table row: ${l}`);
    assert.equal(cells.length, 4, `every numbered rule needs exactly 4 cells, got ${cells.length}: ${l}`);
    const spans = [...cells[3].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const statuses = spans.filter((t) => LIFECYCLE.includes(t));
    assert.equal(statuses.length, 1, `rule ${cells[0]} must name exactly one lifecycle status`);
    return { n: Number(cells[0]), stage: cells[1], condition: cells[2], status: statuses[0] };
  });
}

const normalize = (t) => t.replace(/\s+/g, ' ').trim();

test('the confidence-to-status mapping is an ordered, total decision procedure', () => {
  const sec = phase25Section(readFileSync(skillPath, 'utf8'));
  assert.match(sec, /first matching rule wins/i, 'the table must declare first-match-wins');

  const rules = decisionRules(sec);
  rules.forEach((r, i) => assert.equal(r.n, i + 1, 'rules must be numbered consecutively from 1'));
  assert.deepEqual(
    rules.map((r) => [r.n, r.stage, normalize(r.condition), r.status]),
    EXPECTED_RULES,
    'rule number, stage, exact condition and status must all match',
  );

  // Ordering invariants, stated as what would break if they were violated.
  const closing = rules.filter((r) => r.status === 'Completed');
  assert.equal(closing.length, 1, 'exactly one rule may resolve to `Completed`');
  const validity = rules.find((r) => /empty, unparseable or unaccounted for, and every/i.test(r.condition));
  assert.ok(validity && validity.n < closing[0].n, 'report validity must precede the closing rule');
  const inconclusiveUnchecked = rules.find((r) => /`Inconclusive` on an \*\*unchecked\*\* AC/.test(r.condition));
  assert.ok(inconclusiveUnchecked, 'an unchecked + Inconclusive rule must exist');
  assert.equal(inconclusiveUnchecked.status, 'In Progress',
    'Inconclusive on an unchecked AC must reopen, never advance');
});

// --- The three tickets, as records ---------------------------------------------------------

test('each corrected ticket still carries the status and AC state it was verified at', () => {
  // Every live checkbox AC, gate receipts included — the lifecycle question is "is every box
  // ticked", and the classifier is display-only.
  const readTicket = (rel) => {
    const lines = liveText(readFileSync(resolve(root, rel), 'utf8')).split('\n');
    const start = lines.findIndex((l) => /^##+\s*Acceptance Criteria/i.test(l));
    assert.ok(start >= 0, `${rel} must have an Acceptance Criteria section`);
    let total = 0;
    let checked = 0;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^##\s/.test(lines[i])) break;
      const m = lines[i].match(AC_ITEM);
      if (!m) continue;
      total += 1;
      if (m[1].toLowerCase() === 'x') checked += 1;
    }
    // All three canonical forms: a ticket carrying two Status fields has a status that depends on
    // which one the reader found.
    const statuses = [...lines.join('\n').matchAll(
      /^>\s*\*\*Status\*\*:\s*(.+)$|^#{1,6}\s*Status\s*:\s*(.+)$|^\|\s*Status\s*\|([^|\n]+)\|/gim,
    )].map((m) => (m[1] || m[2] || m[3]).replace(/\*/g, '').trim());
    assert.equal(statuses.length, 1, `${rel} must carry exactly one Status field, found ${statuses.length}`);
    // Progress phase cells take PHASE values, never the ticket's lifecycle value.
    const acceptance = lines.find((l) => /^\|\s*Acceptance\s*\|/.test(l));
    assert.ok(acceptance, `${rel} must carry an Acceptance row in its Progress table`);
    return { status: statuses[0], checked, total, acceptancePhase: tableCells(acceptance)[1].trim() };
  };

  const EXPECTED = {
    'docs/features/auto-loop-autonomy/requests/2026-07-26-dual-mode-signal-repair-r1.md':
      { status: 'In Progress', checked: 8, total: 9, acceptancePhase: 'In Progress' },
    'docs/features/auto-loop-evolution/requests/2026-03-31-stop-hook-recursion-guard-r11.md':
      { status: 'Candidate Complete', checked: 5, total: 5, acceptancePhase: 'Done' },
    'docs/features/claude-code-v21-catchup/requests/2026-05-13-v3-0-12-correctness-patch.md':
      { status: 'Candidate Complete', checked: 9, total: 9, acceptancePhase: 'Done' },
  };
  for (const [rel, want] of Object.entries(EXPECTED)) {
    assert.deepEqual(readTicket(rel), want, `${rel} drifted from its verified state`);
    // The lifecycle invariant these records were corrected to satisfy: all boxes ticked without
    // closure-grade verification is exactly `Candidate Complete`; an unticked box is not.
    if (want.checked === want.total) {
      assert.equal(want.status, 'Candidate Complete', `${rel}: all-checked, not closure-verified`);
    } else {
      assert.ok(!['Candidate Complete', 'Completed'].includes(want.status),
        `${rel}: an unchecked AC cannot read Candidate Complete`);
    }
    // The documented feature-name rule (third path segment) yields the real feature directory.
    assert.equal(rel.split('/')[2], rel.match(/^docs\/features\/([^/]+)\//)[1],
      `${rel}: the third path segment is the feature`);
  }
});

test('the classifier yields the displayed substantive/gate counts for the three tickets', () => {
  const re = gateMatcher(readFileSync(skillPath, 'utf8'));
  const count = (rel) => {
    const lines = liveText(readFileSync(resolve(root, rel), 'utf8')).split('\n');
    const start = lines.findIndex((l) => /^##+\s*Acceptance Criteria/i.test(l));
    const out = { substantive: 0, unchecked: 0, gate: 0 };
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^##\s/.test(lines[i])) break;
      const m = lines[i].match(AC_ITEM);
      if (!m) continue;
      if (re.test(m[2])) { out.gate += 1; continue; }
      out.substantive += 1;
      if (m[1].toLowerCase() !== 'x') out.unchecked += 1;
    }
    return out;
  };

  assert.deepEqual(
    count('docs/features/auto-loop-autonomy/requests/2026-07-26-dual-mode-signal-repair-r1.md'),
    { substantive: 7, unchecked: 1, gate: 2 },
  );
  assert.deepEqual(
    count('docs/features/claude-code-v21-catchup/requests/2026-05-13-v3-0-12-correctness-patch.md'),
    { substantive: 7, unchecked: 0, gate: 2 },
  );
  assert.deepEqual(
    count('docs/features/auto-loop-evolution/requests/2026-03-31-stop-hook-recursion-guard-r11.md'),
    { substantive: 3, unchecked: 0, gate: 2 },
  );
});

test('the creation template emits no unfilled Status legend', () => {
  // Create mode once manufactured the exact placeholder Phase 4.5 then needed a special
  // correction path to delete.
  const raw = readFileSync(resolve(root, 'skills/create-request/references/template.md'), 'utf8');
  for (const block of raw.match(/```markdown\n([\s\S]*?)\n```/g) || []) {
    assert.ok(!/^\*\*Status\*\*:\s*Pending\s*\//m.test(block),
      'the generated ticket must not carry a lifecycle legend');
  }
});

// --- Freeze --------------------------------------------------------------------------------

test('a closed ticket is frozen: update mode may change nothing on it', () => {
  const content = readFileSync(skillPath, 'utf8');
  // Derived from the module rather than restated — a literal list here once silently left `Done`
  // outside the freeze.
  const closedRow = freezeSection(content)
    .split('\n')
    .find((l) => /^\|/.test(l) && /\*\*Nothing\.\*\*/.test(l));
  assert.ok(closedRow, 'the freeze table must carry a row mapping closed statuses to Nothing');
  for (const status of CLOSED_REQUEST_STATUS) {
    assert.ok(closedRow.includes(status), `the freeze row must account for ${status}`);
  }
  assert.match(content, /scripts\/lib\/request-status\.js/, 'the closed set is pointed at its single definition');
  // Open statuses are keyed on the NEGATION of the closed set, the way `isOpenRequestStatus` is —
  // a hand-listed subset left `Design`/`Proposed` with no mutable set at all.
  const openRow = freezeSection(content)
    .split('\n')
    .find((l) => /^\|/.test(l) && /Status, Progress table, AC checkboxes/.test(l));
  assert.ok(openRow, 'the freeze table must map open statuses to the mutable set');
  assert.match(openRow, /not in `CLOSED_REQUEST_STATUS`|isOpenRequestStatus/,
    'the open row must be keyed on the negation of the closed set');
});

test('update-docs refuses to rewrite records — the other half of the freeze', () => {
  const updateDocs = readFileSync(resolve(__dirname, '../../skills/update-docs/SKILL.md'), 'utf8');
  assert.match(updateDocs, /It does not rewrite records/);
  assert.match(updateDocs, /\*\*Do not rewrite\.\*\*/, 'records get status appended, never a re-sync');
  assert.match(updateDocs, /owesCodeAlignment/, 'classification comes from doc-metadata, not from guessing');
});

test('new docs are written to a budget: ticket and tech-spec state theirs at write time', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /write-time target, not a gate/, 'the ticket budget is stated as write-time');
  const techSpec = readFileSync(resolve(__dirname, '../../skills/tech-spec/SKILL.md'), 'utf8');
  assert.match(techSpec, /Within the write-time budget/, 'the spec checklist binds on the budget');
  assert.match(techSpec, /> 400.*cohesion exception/s, 'over budget needs the exception stated in the document');
  const template = readFileSync(resolve(__dirname, '../../skills/tech-spec/references/template.md'), 'utf8');
  assert.match(template, /Budget: ≤ 300 lines/, 'the template opens with the number');
});
