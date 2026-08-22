'use strict';

// R7: pins the closed sets in rules/discretion.md — the anchor register, the 13-file baseline
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
  'scope-discipline.md',
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

test('baseline table when parsed → the full 13-row file/baseline/exception mapping is pinned verbatim', () => {
  // deepEqual over ALL THREE columns: flipping a baseline (framework.md → Anchor) or slipping a
  // "→ Anchor" exception into any row would mint a new anchor OUTSIDE the closed register while
  // a files-only check stays green. Every Anchor-producing cell below maps back to a register item.
  const rows = parseTable(
    section(discretion, 'File Baselines (13 plugin-managed files)'),
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
    ['`scope-discipline.md`', 'Default', 'Edit re-review sentence → Anchor (Register #6); deferred/skip records never carry secrets → Anchor (Register #2); security/data-integrity `thorough` escalation → Anchor (Register #3)'],
  ], 'the classification mapping is closed — changing any cell is a reviewed spec change');
  assert.equal(rows.length, MANAGED_FILES.length);
});

test('override files when classified → excluded from the table and delegated to R8', () => {
  const table = section(discretion, 'File Baselines (13 plugin-managed files)');
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
    /`\/push-ci` skill may execute `git push` — and `git push --force-with-lease` when the caller explicitly passes that flag — after explicit user approval via AskUserQuestion/);
  // The grant is bounded on two axes, and dropping either turns a reviewed widening into
  // an unreviewed one: the flag must be passed explicitly (never inferred), and bare
  // --force stays forbidden to every skill including this one.
  assert.match(gitWorkflow, /Bare `--force` stays forbidden to every skill/,
    'widening to lease-force must not widen to bare force');
  assert.match(gitWorkflow, /The approval must name the force form/,
    'an approval shown as a plain push does not authorize a history rewrite');
  assert.match(gitWorkflow,
    /`\/smart-commit --execute` may execute `git add` \+ `git commit` after explicit user approval via AskUserQuestion/);
  assert.match(gitWorkflow,
    /`\/epic-merge` skill may execute `git rebase --onto`, `git push --force-with-lease`, and `gh pr merge --squash` after explicit per-iteration user approval via AskUserQuestion/);
  // The pre-push hook is opt-in, so the rule must pin BOTH states. Asserting only the
  // installed branch would stay green on a rule that had quietly dropped the other one —
  // and the other one is the branch where nothing stronger than AskUserQuestion exists.
  assert.match(gitWorkflow, /Primary gate = `pre-push-gate\.sh` \(git hook, `\/dev\/tty` confirmation\)/,
    'with the hook installed, push keeps its stronger terminal credential');
  assert.match(gitWorkflow, /the `pre-push` hook is \*\*opt-in\*\*/,
    'the rule must state that the gate is opt-in rather than assumed present');
  assert.match(gitWorkflow, /AskUserQuestion in `\/push-ci` \*\*is\*\* the authorization/,
    'where no terminal credential runs, the in-session approval is the authorization, not a skipped step');
  // The hook prompts on a bounded set of classes — since 2026-08-21 two of them: a
  // protected branch with its bypass unset, and a push that overwrites an existing ref
  // with its own bypass unset. Pinning "installed ⇒ terminal credential" alone would
  // bless an ordinary fast-forward push whose only approval was a cached
  // AskUserQuestion, leaving Anchor Register #4's per-use approval existing on paper
  // and nowhere else. What must stay pinned is that the set is bounded and that the
  // rule names the credential for everything outside it.
  assert.match(gitWorkflow, /prompts on two classes/,
    'the rule must say the installed hook does not cover every push');
  // Ancestry is the BRANCH rule, and saying so is load-bearing. Round 31 shipped the tag
  // short-circuit into the gate while this rule still defined the class as "not an ancestor"
  // alone — so the normative text described a gate that waves through exactly what git
  // itself calls a forced update. Pinned POSITIVELY, in three parts, because each is a
  // separate boundary the code enforces and a doc could quietly drop one:
  //   (a) tags are judged by namespace, not ancestry;
  //   (b) a tag CREATION is still excluded — otherwise every first tag push is refused;
  //   (c) an unchanged OID is excluded — asking about a ref that is not moving is how a
  //       prompt gets answered without being read;
  //   (d) a DELETION is excluded — the null-OID test is applied to both sides, so removing an
  //       existing ref reaches no prompt. Added round 64, because (a)-(c) read as a complete
  //       enumeration and left this one silently outside a class the same sentence called
  //       "every update to an existing tag". Pinned as a boundary, not as an approval of it:
  //       what must not happen again is the gap being invisible in the normative text.
  assert.match(gitWorkflow,
    // "force semantics", not the bare flag: measured 2026-08-21, a forward tag move is rejected
    // plain and accepted by `--force`, by a satisfied `--force-with-lease=<ref>:<oid>`, and by a
    // leading `+`. Pinning one spelling would be a rule about a flag; the class is topological.
    /for a \*\*tag\*\* that test is the wrong question, since git requires force semantics — `--force`, a satisfied `--force-with-lease`, or a leading `\+` in the refspec — for any update to an existing `refs\/tags\/\*` ref, forward moves included/,
    'the rule must define the tag class by namespace rather than by ancestry (a)');
  assert.match(gitWorkflow,
    /while a tag \*creation\*, having no history to overwrite, is not/,
    'the rule must keep tag creation outside the class (b)');
  assert.match(gitWorkflow,
    /A ref listed with an unchanged OID moves nothing and is likewise not asked about\./,
    'the rule must keep an unchanged ref outside the class (c)');
  assert.match(gitWorkflow,
    /the gate's rewrite test requires a non-null OID on \*\*both\*\* sides, so removing an existing ref/,
    'the rule must state that a deletion reaches no prompt, rather than implying it does (d)');
  assert.match(gitWorkflow, /For every push in neither class, and whenever the hook is not installed/,
    'the rule must name the credential for the pushes the hook does not prompt on');
  // The hook is opt-in, so for a history-rewriting push the un-hooked configuration has
  // no terminal attestation at all. The rule closes that by obliging the two authorized
  // workflows to ask the unshared question themselves. Dropping this sentence would
  // leave option A as a property of a file a project may simply not have installed.
  assert.match(gitWorkflow,
    /must put the unshared question to the user \*\*themselves, by name and before the force approval\*\*, and refuse the push when the answer is not the attestation/,
    'the rule must oblige the skills to attest where no hook does');
  // Clearing, not merely not-setting: an inherited value answers the hook for nobody.
  assert.match(gitWorkflow, /must never set it \*\*and must clear it on every push they execute\*\*/,
    'the rule must require the bypass variable to be cleared, not merely left unset');
  // The exclusion that left the hole: it holds only while the protected prompt runs.
  assert.match(gitWorkflow,
    /excluded from this prompt \*\*only while the protected prompt will actually ask about it\*\*/,
    'the rule must make the protected-target exclusion conditional on that prompt running');
  // Non-fast-forward reads like a prompt and is not one — it is a refusal. Which
  // mechanism refuses depends on the push form, measured on git 2.55.0: flagless, git
  // rejects the ref client-side and invokes the hook with an EMPTY ref list, so the gate
  // finds no branch and exits 0 having refused nothing; force-form, git supplies the ref
  // and the hook's own exit 1 fires. Attributing the flagless refusal to the gate credits
  // a guard for a rejection it never saw. But a refusal is not incapable of a prompt
  // either: with ALLOW_FORCE_WITH_LEASE=1 it is skipped and a protected non-fast-forward
  // push reaches /dev/tty. The rule must state the orthogonality, not either half of it.
  assert.match(gitWorkflow, /orthogonal earlier refusal, not a class of its own/,
    'a refusal must not be documented as a confirmation');
  assert.match(gitWorkflow, /which mechanism refuses depends on the push form/,
    'the rule must not attribute every non-fast-forward refusal to the hook');
  assert.match(gitWorkflow, /the hook is invoked with an empty ref list/,
    'and it must say what the hook actually receives on the flagless push — nothing to refuse');
  assert.match(gitWorkflow, /a \*protected\* non-fast-forward push does reach `\/dev\/tty`/,
    'the case where the terminal prompt does happen must be stated');
  assert.doesNotMatch(gitWorkflow, /Install via `\/install-scripts`\./,
    '/install-scripts copies the script; it never wires up a hook');
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
  const prop = section(discretion, 'Proposal Channel');
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
  const prop = section(discretion, 'Efficacy Boundary');
  assert.match(prop, /session caching/);
  assert.match(prop, /never the sole credential for a safety approval outside the workflow that defines it/);
  assert.match(prop, /pre-push-gate\.sh/, 'push keeps its stronger named mechanism');
  // Every assertion in this test is a positive match, so none of them can see a widening that
  // ADDS an unconditional sentence beside the conditional ones. A phrase blacklist was tried here
  // and is not the answer in either direction — measured: a synonymous unconditional sentence
  // ("pre-push-gate.sh remains the final authority; AskUserQuestion merely advises") passes it,
  // while a lawful conditional rewording that happens to contain the blacklisted words fails it.
  // Closure over English spellings is what `validateEfficacyBoundary` below does by byte identity.
  assert.match(prop, /where that mechanism is actually in place/,
    'the first statement of the carve-out must already carry the condition');
  assert.match(prop, /that names no stronger mechanism/,
    'the sufficiency clause must not cover workflows with a stronger named credential');
  assert.match(prop, /`\/smart-commit --execute` operates on exactly that contract/,
    'workflows whose defined credential IS per-use AskUserQuestion stay valid');
  // /epic-merge left that list on 2026-08-21: its pushes rewrite history, so where the
  // hook is installed they meet the same terminal attestation /push-ci's do. It belongs
  // to BOTH halves of the clause now, and the section must say so — dropping either half
  // would either revoke the workflow (hook absent, no credential named) or bless a cached
  // approval for a push the terminal actually gated (hook present).
  assert.match(prop, /`\/epic-merge` sat here until 2026-08-21 and now sits in both places at once/,
    'a workflow that gained a stronger mechanism must be stated in both halves, not moved silently');
  assert.match(prop, /a history-rewriting push in an un-hooked project reaches no terminal at all/,
    'the opt-in gap must be stated where the credential is chosen, not only in git-workflow.md');
  assert.match(prop, /`\/push-ci`.*`pre-push-gate\.sh` is the terminal credential/,
    'push is explicitly carved out of the sufficiency clause');
  // The carve-out is conditional on the mechanism existing. Without this pair, the
  // assertion above passes on a rule that still claims an uninstalled hook outranks
  // the approval — which would leave the hook-absent push with no stated credential.
  assert.match(prop, /but only where that mechanism exists/,
    'the stronger-mechanism carve-out must turn on the mechanism being present');
  assert.match(prop, /where the hook is \*\*not\*\* installed .* there is no stronger mechanism to bypass/,
    'the hook-absent branch must be stated, not left to inference');
  // An installed hook is not the same as a prompting hook: pre-push-gate.sh exits without
  // touching /dev/tty for an ordinary fast-forward push. Pinning only the installed/absent
  // axis would leave that push claiming a terminal credential that never ran.
  assert.match(prop, /only for the pushes it actually prompts on/,
    'the carve-out must be scoped to the pushes the hook prompts on, not to installation alone');
  assert.match(prop, /installed and \*\*exits 0\*\* without prompting/,
    'the installed-but-silent case must be stated, not left to inference');
  assert.match(prop, /required and sufficient on the same contract as the workflows above/,
    'with no hook, per-use AskUserQuestion is the credential — same contract as /smart-commit and /epic-merge');
  // A REFUSED push is neither branch of that disjunction, and the refusal has two sources.
  // On a force-form push pre-push-gate.sh exits 1 with ALLOW_FORCE_WITH_LEASE unset
  // (scripts/pre-push-gate.sh § "Non-fast-forward push check"), before the decision at
  // § "Protected branch gate" is ever reached — cited by SECTION, because the line numbers this
  // comment carried until round 64 (`:70-76` and `:78-82`) had drifted onto the re-exec block and
  // named nothing of the kind. The ordering the sentence rests on is checked just below rather
  // than asserted here, since a citation that cannot drift is still not a citation that is true.
  // On a flagless one git rejects the ref itself and the hook never sees it. Either
  // way no credential was selected and the push never happened — which is what this section
  // needs; what it must not do is name only the first, since a reader who pushes flaglessly
  // would then expect a gate refusal that the gate has no opportunity to make.
  // Folding it into the exits-without-prompting branch
  // would read as "AskUserQuestion sufficed" for an operation that did not run, which is the
  // one direction this whole section exists to forbid.
  // The ordering the comment above rests on, read from the gate itself. Cheap, and it is the half
  // a section citation cannot supply: naming the right sections proves they exist, not that the
  // force refusal comes first. If they ever swap, a force-form push to a protected branch would
  // reach `/dev/tty` before being refused — the operator would answer a question about a push that
  // was never going to happen, which is the shape this whole section is written against.
  const gate = readFileSync(resolve(root, 'scripts/pre-push-gate.sh'), 'utf8').split('\n');
  const forceCheck = gate.findIndex((l) => l.startsWith('# ── Non-fast-forward push check'));
  const protectedGate = gate.findIndex((l) => l.startsWith('# ── Protected branch gate'));
  assert.ok(forceCheck >= 0, 'the gate must carry the section this comment cites by name');
  assert.ok(protectedGate >= 0, 'and the protected-branch section it cites as coming later');
  assert.ok(forceCheck < protectedGate,
    'the non-fast-forward refusal must precede the protected-branch decision, as the rule says');

  assert.match(prop, /A \*\*refused\*\* push is a third outcome outside that disjunction/,
    'the refusal must be excluded from the sufficiency disjunction, not filed inside it');
  assert.match(prop, /an authorization of nothing/,
    'the refusal must name why nothing was authorized, citing git-workflow.md');
  assert.match(prop, /a \*protected\* non-fast-forward push still reaches `\/dev\/tty`/,
    'with the variable set the push falls through to the protected decision');
  // Negative control (@rules/testing.md § Guards): deleting the carve-out must be visible.
  // Without it the two assertions above are green on a section that never had the sentence —
  // they would pass just as happily if the pin were the only thing holding it.
  const carveOut = 'A **refused** push is a third outcome outside that disjunction';
  assert.equal(prop.split(carveOut).length - 1, 1, 'precondition: the carve-out is stated exactly once');
  const collapsed = prop.replace(carveOut, 'A **refused** push is one such case');
  assert.notEqual(collapsed, prop, 'fixture stale — the carve-out sentence no longer reads as pinned');
  assert.doesNotMatch(collapsed, /A \*\*refused\*\* push is a third outcome outside that disjunction/,
    'a refusal re-filed as a case inside the disjunction must not satisfy the assertion above');
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
  const baselines = section(discretion, 'File Baselines (13 plugin-managed files)');
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

// Everything above is an independent positive match, so all of it stays green while a FOURTH
// grant is added beside it. What this block pins is closure.
//
// Closure over *complete command forms*, not over operation prefixes. A prefix check reads
// `git push -f` as an ordinary `git push` and `git -C . rebase --onto` as no git command at all,
// so it authorizes by accident what the contract forbids on purpose. Every git and gh command in
// this rule is written inside a backtick span; comparing those spans verbatim against a pinned
// list makes the set closed by construction, and needs no opinion about which options are
// dangerous. One rule keeps the extraction honest: nothing **between the region bounds** may name
// `git`/`gh` outside a span, or it would be invisible to the comparison. Outside those bounds
// there is no such rule and no scan — the residual stated at § "The residual, stated and fixtured
// below" and its passing fixtures are exactly that gap, and an earlier version of this paragraph
// claimed the opposite.
//
// One validator, used by the live assertion and by both mutation directions. Factoring it out is
// the point: a control that re-implements a subset of the check reports on itself, not on the
// rule, and can pass while the real pin rejects the very text it calls acceptable.

// A span *containing* a destructive command, not one that starts with it: `env git push -f` and
// `command git push -f` are the same push through a wrapper, and a start-anchored pattern reads
// them as no command at all — then the bare-word check below never sees the inner git either,
// because the whole span was stripped as a code span.
const COMMAND_SPAN = /`([^`]*\b(?:git|gh)\b[^`]*)`/g;
const BARE_COMMAND_WORD = /(?<!`)\b(?:git|gh)\b(?![^`]*`)/;
// Outside the region the wide pattern cannot be used: backtick spans alternate, so prose that puts
// two unrelated spans on one line makes the gap between them look like a span, and `pre-push-gate.sh`
// … `/dev/tty` on line 14 really does yield "(git hook,". The outside rule is therefore bounded to
// destructive command forms — the operations Register #4 governs — and claims nothing about a
// backticked `git status`, which is not a grant this contract could widen.
const DESTRUCTIVE_FORM = /\b(?:git (?:push|add|commit|rebase|reset|stash)|gh pr merge)\b/;

// **The closure is a snapshot over a block the source itself declares.** Rounds 6–13 of review
// each defeated the previous lexical control with a spelling it did not anticipate: an option
// before the subcommand, a wrapper in front of the command, a disclaimer after the credential,
// `g""it push -f` (three shell word fragments the word `git` never occurs in), a waiver written
// into a different paragraph, and finally a waiver written into a paragraph whose *prefix* was on
// an allowlist. English has an unbounded space of equivalent spellings; no pattern closes it.
//
// So the boundary is declared in `rules/git-workflow.md` with `<!-- anchor:register-4:begin -->`
// and `:end`, and everything between the markers is pinned byte-for-byte — closed by construction,
// with no inference about which paragraph "is" authorization.
//
// **Two earlier attempts and why each was wrong.** Pinning the whole file made adding `chore/*` to
// `Branches:` fail an Anchor-named test, although `rules/discretion.md` gives this file a Default
// baseline and elevates only destructive operations, protected branches, attribution and secrets.
// Replacing that with an allowlist of line *prefixes* outside the block was worse in both
// directions at once: a waiver reusing the allowed `PR workflow:` prefix passed, while adding a
// blank line failed. Prefix identity is not a semantic boundary, and inventing one was the error.
//
// **Outside the markers there is now no scan at all, and that is the fix rather than a gap.**
// Three successive revisions tried to police the rest of the file — first an execution-verb
// vocabulary rule, then a destructive-command scan — and every one of them failed in BOTH
// directions on evidence:
//
//   `Authorized: /release-bot may execute `git\n   push -f` after approval.`
//        → a real grant in a valid multiline CommonMark code span; a line-at-a-time scan sees
//          `git` on one line and `push -f` on the next, and reports nothing
//   "PR documentation: the report prints the literal example `git push`; it does not execute it."
//        → honest Default-tier documentation, reported as a grant
//
// The second is disqualifying on its own: `rules/discretion.md` gives this file a **Default**
// baseline, so ordinary edits must be free, and a test named after an Anchor contract that blocks
// them gets weakened by the next maintainer — taking the pins with it.
//
// **What this suite therefore claims, exactly.** Three pinned surfaces, each a line-exact snapshot
// of material `rules/discretion.md` § File Baselines names as Anchor for this file:
//
//   1. the marked authorization block — the prohibition and its three enumerated grants
//   2. the Push safety paragraph — which credential authorizes a push (round 5 added it)
//   3. the Prohibited / Protected-branches paragraph (round 16 added it)
//
// All three are closed by construction — any widening, in any spelling, changes bytes. Everything
// else in this file is Default-tier prose that this suite does not judge.
//
// **The scoping rule, since three revisions have missed it in one direction or the other:** pin the
// lines the tier registry names — not the Default-tier prose around them, and not fewer. A pin that
// reaches past its Anchor content makes ordinary edits fail an Anchor-named test (round 14 swallowed
// `Claude allowed:`; round 17 swallowed this test's own rationale); a pin that stops short leaves an
// Anchor surface widenable with a green suite (round 16, the protected-branch line). Both are tier
// errors and only line-exact scoping avoids both.
//
// **The residual, stated and fixtured below.** A grant written outside all three pinned surfaces is
// not detected here. What makes it reviewable is structural rather than lexical: the markers declare
// where authorization lives, so a sentence about authorization sitting outside them is visible to
// document review as misplaced. Claiming to catch it mechanically is what four rounds disproved.
const CANONICAL_AUTHORIZATION_BLOCK = [
  // **The marker line carries the token and nothing else, and rounds 17–18 are why.** It used to
  // carry the whole rationale below — inside the byte pin, because a delimiter that is not pinned
  // can be moved. The reviewer changed "Pinned byte-for-byte" to "Snapshot-pinned byte-for-byte"
  // and two Anchor-named tests failed on an edit that moved no command, no credential and no
  // marker. Shortening the sentence did not fix that; it shortened the string a maintainer would
  // reword. Only removing the prose does, because `rules/discretion.md` elevates destructive ops,
  // protected branches, attribution and secrets — not any description of how this test works.
  //
  // So the rule file keeps the token; the reasoning lives here, where editing it is free. There is
  // now nothing inside the pin that anyone would touch for style, which is what makes pinning the
  // delimiter honest rather than obstructive.
  "<!-- anchor:register-4:begin -->",
  "Claude forbidden: git add | commit | push | stash | reset --hard | rebase",
  "Exception: `/push-ci` skill may execute `git push` — and `git push --force-with-lease` when the caller explicitly passes that flag — after explicit user approval via AskUserQuestion. Bare `--force` stays forbidden to every skill. The approval must name the force form: a plan that shows a plain push while a lease-force runs is not an approval of what happens",
  "Exception: `/smart-commit --execute` may execute `git add` + `git commit` after explicit user approval via AskUserQuestion",
  "Exception: `/epic-merge` skill may execute `git rebase --onto`, `git push --force-with-lease`, and `gh pr merge --squash` after explicit per-iteration user approval via AskUserQuestion (stacked PR chain workflow)",
  "<!-- anchor:register-4:end -->",
].join('\n');
const BLOCK_BEGIN = '<!-- anchor:register-4:begin';
const BLOCK_END = '<!-- anchor:register-4:end';

// **A second pin, one line, same construction.** The Push safety paragraph decides WHICH
// credential authorizes a push — `pre-push-gate.sh` over `/dev/tty` where the hook is installed
// and prompting, AskUserQuestion in `/push-ci` everywhere else. That selection is Register #4
// material in exactly the way the grant block is: "the approval is optional" written into it
// waives the credential without naming a command or an execution verb, so neither the block pin
// nor the lexical scan can see it — it was the suite's stated residual risk until review round 5
// flagged it. Pinned as a blank-line-delimited PARAGRAPH that must equal this single line —
// round 5 executed the probe that defeats a bare `includes`: a waiver on an adjacent physical
// line, no blank line between, renders inside the credential paragraph while the canonical bytes
// survive untouched. The operational details the paragraph cites (install commands, Phase 0 hook
// detection) stay Default tier in the files that own them, so this widens no tier boundary.
const CANONICAL_PUSH_SAFETY_LINE = "Push safety (credential-selection contract — Anchor Register #4 material, byte-pinned as one line by `test/rules/discretion-tiers.test.js`; the operational install/detection details it cites stay Default tier in their own files): the `pre-push` hook is **opt-in** (`/codex-setup init --with-push-gate`, or `/codex-setup sync --with-push-gate` on an existing project; `/install-scripts` only copies the script and never wires up a hook), so which credential authorizes a push depends on whether it is installed **and** on what the push is. The hook prompts on two classes, and they ask different questions: (i) a push whose ref set includes a **protected branch**, with `ALLOW_PUSH_PROTECTED` unset — *may this branch be pushed to at all*; and (ii) a push that **rewrites a ref other people may already hold**, with `ALLOW_FORCE_UNSHARED` unset — and what counts as a rewrite is decided **per ref class**, so the branch rule stated next is not the whole class: for a **branch** it is a non-fast-forward, read **fail-closed**, so ancestry *failing to answer* counts exactly as ancestry answering no — the gate negates `merge-base --is-ancestor` with `!`, which collapses its exit 1 — not an ancestor — and every error above it (a corrupt or unreadable graph) into the same branch, making the class *not provably a fast-forward* rather than *provably a rewrite*; for an **existing tag** the ancestry answer never *decides* — the gate ORs `is_tag_ref` over the negated ancestry test, so `merge-base` still runs on a tag and is simply overridden, and every update to one is in the class whichever way it answered, forward moves included (why, below). Over the rewritten refs class (i) does not already cover, the question is *is anybody else working on them*. For either class, with the hook installed: Primary gate = `pre-push-gate.sh` (git hook, `/dev/tty` confirmation), and AskUserQuestion in `/push-ci` is advisory only (session caching may auto-approve). For every push in neither class, and whenever the hook is not installed: AskUserQuestion in `/push-ci` **is** the authorization — there is no stronger mechanism to defer to, and treating an absent gate as a reason to push unasked would turn opting out of a confirmation into opting out of approval. Because the hook is opt-in, that second case is where class (ii) would otherwise have no attestation at all, so `/push-ci` and `/epic-merge` must put the unshared question to the user **themselves, by name and before the force approval**, and refuse the push when the answer is not the attestation — approval of a force form is not evidence about who else holds the branch. Non-fast-forward is an orthogonal earlier refusal, not a class of its own: without `ALLOW_FORCE_WITH_LEASE=1` the push is refused before any credential is selected, but **which mechanism refuses depends on the push form** — the hook's own `exit 1` where git hands it the ref (the force-form push), and git itself, client-side, **before the hook runs** where it does not. That second case is the flagless one: git withholds a ref it has already rejected, so the hook is invoked with an empty ref list, finds no branch, detects no divergence and exits 0 having refused nothing — the `[rejected] … (non-fast-forward)` the operator sees is git's, not the gate's. Either way an authorization of nothing, since the push does not happen; and with the variable set it falls through to the same protected-branch decision, so a *protected* non-fast-forward push does reach `/dev/tty`. **A second, orthogonal gate stands beside that one** (2026-08-21, option A — `docs/features/push-gate-optin/requests/2026-08-20-push-ci-force-with-lease-r5.md`): a push that rewrites history must additionally carry an attestation that the rewritten refs are not shared — either `ALLOW_FORCE_UNSHARED=1`, or the operator typing `yes` at the hook's `/dev/tty` prompt naming them. What is measured is the **topology, not the declared flag** — and topology is read per ref class, because ancestry is the *branch* rule: for a branch the gate asks about the refs whose remote tip is not an ancestor of what replaces it, so a `--force-with-lease` that turns out to be an ordinary fast-forward rewrites nothing and is not asked about; for a **tag** that test is the wrong question, since git requires force semantics — `--force`, a satisfied `--force-with-lease`, or a leading `+` in the refspec — for any update to an existing `refs/tags/*` ref, forward moves included — a tag names one commit rather than a line of history — so every update to an existing tag is asked about while a tag *creation*, having no history to overwrite, is not. A ref listed with an unchanged OID moves nothing and is likewise not asked about. A **deletion** is the third exclusion, and it is the one an \"every update to an existing tag\" reading loses: the gate's rewrite test requires a non-null OID on **both** sides, so removing an existing ref — `git push origin :refs/tags/v1` — reaches neither prompt. The boundary this draws is narrow and deliberate: the class is about *overwriting* a line of history, not about *removing* a ref. Whether a deletion of something other people hold deserves a prompt of its own was put to the maintainer on 2026-08-22 and deliberately answered *no change*: the class stays about overwriting, and widening it would be its own request, its own attestation and its own refusal path. A rewrite bundled with ordinary creations is asked about for the rewritten refs alone. Non-branch refs keep their full name in the prompt, since a forced tag update is a rewrite of something other people hold. This is what closes the gap between \"shared\" and \"protected\": git cannot decide sharedness, because no ref line, ancestry test or lease reports who else holds the branch, so the class is defined by **attestation, not inference**, and the attestation is the operator's. Three properties are part of the contract: `ALLOW_FORCE_UNSHARED` is developer-set only — `/push-ci` and `/epic-merge` must never set it **and must clear it on every push they execute**, exactly as with `ALLOW_PUSH_PROTECTED`, because a value exported earlier in the shell answers the hook's question without anybody being asked now; `ALLOW_PUSH_PROTECTED` does not skip it, since the two answer different questions; and a rewritten ref is excluded from this prompt **only while the protected prompt will actually ask about it** — `ALLOW_PUSH_PROTECTED=1` silences that prompt, so under it the ref returns to this one. Asking twice about one push is noise rather than depth; asking zero times is the hole an unconditional exclusion left, and it force-pushed `main` past both gates in silence. Never assume which state applies — but never let the hook check decide it either. `/push-ci` Phase 0 reports whether an executable hook *references* the gate (`PUSH_GATE=referenced`, never `installed`), and reference is not invocation: a script that merely names the gate in a live command satisfies the same test. The probe therefore informs how the push plan **describes** the credential; it never **selects** one. The demotion of AskUserQuestion to advisory is earned by the operator seeing the `/dev/tty` prompt, never by the check predicting it — if the approval is given and no prompt appears, that in-session approval was the only approval, whatever the probe reported. This is safe in exactly one direction, and only because nothing is ever skipped on the probe's word.";

// **A third pin, two lines, and the round that earned it.** `rules/discretion.md` § File Baselines
// elevates **protected branches** to Anchor for this file, alongside the destructive ops — and
// round 16 executed the consequence of leaving them unpinned: appending
// `— except when /release-bot pushes without confirmation` to the Protected-branches line widened
// an Anchor surface with all 21 tests green. The grant block and the credential line were both
// byte-identical, so both pins were silent, correctly and uselessly.
//
// The earlier block comment argued that pinning this material would be a tier error. That was true
// of the shape then proposed — a region pin swallowing `Claude allowed:` and the installation
// prose with it — and false of the material itself: these two lines carry **no Default-tier
// content at all**. Line 1 is the prohibition (protected-branch push, force push to shared
// branches — Register #4; secrets — Register #2); line 2 is the protected-branch list the whole
// prohibition refers to. Pinning exactly them adds no Default-tier byte to any Anchor-named test,
// which is the property that made the earlier objection valid and this pin safe.
//
// The general rule, since three revisions have now missed it in one direction or the other: pin
// the lines the tier registry names — not the prose around them, and not fewer.
const CANONICAL_PROHIBITION_PARAGRAPH = [
  'Prohibited: Push to protected branches without confirmation | Force push to shared branches | Commit containing secrets',
  'Protected branches: main | master | develop | release/*',
].join('\n');

// Anchor Register #4's closed list, spelled as the exact commands each workflow may run.
const AUTHORIZED_GRANTS = [
  ['/push-ci', ['git push', 'git push --force-with-lease']],
  ['/smart-commit --execute', ['git add', 'git commit']],
  ['/epic-merge', ['git rebase --onto', 'git push --force-with-lease', 'gh pr merge --squash']],
];

function commandSpans(line) {
  return [...line.matchAll(COMMAND_SPAN)].map((m) => m[1].replace(/\s+/g, ' ').trim());
}

function validateDestructiveContract(text) {
  const problems = [];
  const lines = text.split('\n');
  // The region is the prohibition plus its enumerated grants — nothing else. `Claude allowed:` used
  // to close it, and that was wrong: a read-only list is Default tier (rules/discretion.md), so
  // pinning it made adding `git show` fail an Anchor-named test.
  const start = lines.findIndex((l) => l.startsWith('Claude forbidden:'));
  const end = lines.reduce((last, l, i) => (l.startsWith('Exception:') ? i : last), -1);
  if (start === -1 || end <= start) return ['the destructive-git region lost one of its bounds'];

  const region = lines.slice(start, end + 1);
  // Exactly one marked block: a second pair would let a grant sit in a block nothing pins, and a
  // missing pair would silently reduce this whole validator to the literal scan at the end.
  const begins = lines.filter((l) => l.startsWith(BLOCK_BEGIN)).length;
  const ends = lines.filter((l) => l.startsWith(BLOCK_END)).length;
  if (begins !== 1 || ends !== 1) return [`the authorization block must be marked exactly once (${begins} begin, ${ends} end)`];
  const blockStart = lines.findIndex((l) => l.startsWith(BLOCK_BEGIN));
  const blockEnd = lines.findIndex((l) => l.startsWith(BLOCK_END));
  if (blockEnd < blockStart) return ['the authorization block markers are inverted'];
  if (blockStart > start || blockEnd < end) return ['the authorization block markers no longer enclose the contract'];
  if (lines.slice(blockStart, blockEnd + 1).join('\n') !== CANONICAL_AUTHORIZATION_BLOCK) {
    problems.push('the authorization block no longer matches its pinned text');
  }
  // The credential-selection contract is pinned the same way: byte-identity, not pattern — but
  // the unit compared is the PARAGRAPH, not the physical line, and the declaration must be
  // unique. Round 5 executed the counterexample against a plain `includes` check: prepend
  // "The approval is optional." directly above the canonical line, no blank line between, and
  // Markdown renders both as one paragraph — the waiver sits inside the credential paragraph
  // while the untouched canonical bytes still satisfy `includes`. So: exactly one declaration,
  // and the maximal blank-line-delimited run around it must consist of the pinned line alone.
  // The rule file keeps the paragraph isolated by blank lines to make that hold; a neighbour
  // line joining the paragraph is exactly the mutation this is meant to report.
  const psDecls = lines.reduce((acc, l, i) => (l.startsWith('Push safety') ? [...acc, i] : acc), []);
  if (psDecls.length !== 1) {
    problems.push(`the push-safety credential contract must be declared exactly once (found ${psDecls.length})`);
  } else {
    let psTop = psDecls[0];
    let psBottom = psDecls[0];
    while (psTop > 0 && lines[psTop - 1].trim() !== '') psTop--;
    while (psBottom < lines.length - 1 && lines[psBottom + 1].trim() !== '') psBottom++;
    if (lines.slice(psTop, psBottom + 1).join('\n') !== CANONICAL_PUSH_SAFETY_LINE) {
      problems.push('the push-safety credential paragraph no longer matches its pinned text');
    }
  }
  // The prohibition and its protected-branch list, pinned as one paragraph for the same reason the
  // credential line is: a waiver appended to an adjacent physical line renders inside the same
  // paragraph, so comparing the physical line alone would leave the exact widening round 16
  // executed still available one line down.
  const prohDecls = lines.reduce((acc, l, i) => (l.startsWith('Prohibited:') ? [...acc, i] : acc), []);
  if (prohDecls.length !== 1) {
    problems.push(`the prohibition must be declared exactly once (found ${prohDecls.length})`);
  } else {
    let pTop = prohDecls[0];
    let pBottom = prohDecls[0];
    while (pTop > 0 && lines[pTop - 1].trim() !== '') pTop--;
    while (pBottom < lines.length - 1 && lines[pBottom + 1].trim() !== '') pBottom++;
    if (lines.slice(pTop, pBottom + 1).join('\n') !== CANONICAL_PROHIBITION_PARAGRAPH) {
      problems.push('the prohibition / protected-branches paragraph no longer matches its pinned text');
    }
  }
  const body = region.slice(1);

  for (const line of body) {
    // No prose between the bounds. Explanatory text belongs outside the region, where nothing
    // here scans it (the return below says so, and the header records why) — inside, an
    // unrecognised line is an unreviewed grant in disguise.
    if (!line.startsWith('Exception:')) problems.push(`non-exception line inside the region: ${line}`);
    // An unbackticked command would slip past the span comparison entirely.
    const stripped = line.replace(/`[^`]*`/g, '');
    if (BARE_COMMAND_WORD.test(stripped)) problems.push(`git/gh named outside a code span: ${line}`);
    // The credential — the second dimension — is **not** checked by pattern here, deliberately.
    // A regex over English can require one canonical approval phrase or enumerate a handful of
    // waiver phrasings; it cannot do both, and the version that tried rejected honest rewordings
    // while passing "The approval is optional." The snapshot above covers the dimension exactly:
    // any text that adds, removes or weakens the approval clause changes the region's bytes.
  }

  const parsed = body
    .filter((l) => l.startsWith('Exception:'))
    // Not deduplicated: multiplicity is part of the pin. A second `git push` on the same line is
    // how "it may also execute `git push` without user approval" hides — the command is already
    // authorized, so a set collapses the contradiction into the grant it contradicts.
    .map((l) => [(l.match(/^Exception: `([^`]+)`/) || [])[1], commandSpans(l)]);

  const names = parsed.map(([name]) => name);
  const expectedNames = AUTHORIZED_GRANTS.map(([name]) => name);
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    problems.push(`the enumerated workflows are a closed set: ${JSON.stringify(names)}`);
  } else {
    // Names matching is the weaker half. Compare what each one is actually granted.
    parsed.forEach(([name, commands], i) => {
      const expected = AUTHORIZED_GRANTS[i][1];
      if (JSON.stringify(commands) !== JSON.stringify(expected)) {
        problems.push(`${name} grants ${JSON.stringify(commands)}, Register #4 enumerates ${JSON.stringify(expected)}`);
      }
    });
  }

  // Nothing scans outside the three pinned surfaces — see the header comment for the evidence that
  // retired the scan. The pins are the whole mechanical claim; the rest of this Default-tier file
  // is document review's.
  return problems;
}

test('the destructive-git contract when validated → grants exactly what Anchor Register #4 enumerates', () => {
  assert.deepEqual(validateDestructiveContract(gitWorkflow), []);
});

test('the validator when the contract is widened → reports it, and says which dimension moved', () => {
  // Six widenings, each measured against this same validator. The first three keep all three
  // workflow names intact, which is precisely what a name-only pin cannot see; the fourth and
  // fifth are the option forms a prefix-shaped check reads as something already authorized.
  const widenings = {
    'an operation appended to an existing exception': (t) => t.replace(
      'Exception: `/smart-commit --execute` may execute `git add`',
      'Exception: `/smart-commit --execute` may execute `git rebase --onto` and `git add`'),
    'a short option that a prefix check reads as the plain command': (t) => t.replace(
      'Bare `--force` stays forbidden', 'It may also execute `git push -f`. Bare `--force` stays forbidden'),
    'a global option before the subcommand': (t) => t.replace(
      'Bare `--force` stays forbidden', 'It may also execute `git -C . rebase --onto`. Bare `--force` stays forbidden'),
    'a second executable the register never names': (t) => t.replace(
      'Bare `--force` stays forbidden', 'It may also execute `gh pr merge --admin`. Bare `--force` stays forbidden'),
    'a fourth exception line': (t) => t.replace('Claude allowed:',
      'Exception: `/release-bot` may execute `git push --force` after user approval\nClaude allowed:'),
    'an unbackticked command inside the region': (t) => t.replace(
      'Bare `--force` stays forbidden', 'It may also execute git push -f. Bare `--force` stays forbidden'),
    'the same command re-granted without its approval credential': (t) => t.replace(
      'Bare `--force` stays forbidden', 'It may also execute `git push` without user approval. Bare `--force` stays forbidden'),
    'a wrapper in front of the command inside the span': (t) => t.replace(
      'Bare `--force` stays forbidden', 'It may also execute `env git push -f`. Bare `--force` stays forbidden'),
    'a shell builtin in front of the command inside the span': (t) => t.replace(
      'Bare `--force` stays forbidden', 'It may also execute `command git push -f`. Bare `--force` stays forbidden'),
    'an exception stripped of its approval credential': (t) => t.replace(
      ' after explicit user approval via AskUserQuestion', ''),
    // Was the suite's stated residual risk until round 5: a waiver in the credential-selection
    // paragraph names no command and no execution verb, so only the paragraph pin can move on it.
    'a waiver inserted into the pinned push-safety credential paragraph': (t) => t.replace(
      'Push safety (credential-selection contract', 'Push safety: the approval is optional. (credential-selection contract'),
    'the push-safety credential paragraph deleted outright': (t) => t.split('\n')
      .filter((l) => !l.startsWith('Push safety (')).join('\n'),
    // Round 5's executed probes: the canonical line survives untouched, so `includes` passes,
    // but the waiver shares its Markdown paragraph. Prepended, appended, and as a second
    // declaration — the three ways to sit beside a pin instead of inside it.
    'a waiver prepended in the same paragraph, canonical line retained': (t) => t.replace(
      'Push safety (credential-selection contract', 'The approval is optional.\nPush safety (credential-selection contract'),
    'a waiver appended in the same paragraph, canonical line retained': (t) => t.replace(
      "skipped on the probe's word.\n", "skipped on the probe's word.\nThe approval is optional.\n"),
    'a second push-safety declaration beside the pinned one': (t) => t.replace(
      'Push safety (credential-selection contract', 'Push safety: the approval is optional.\nPush safety (credential-selection contract'),
    // The two spellings that defeat a credential regex and a command regex respectively: a waiver
    // phrased in words no negative pattern enumerates, and a command the word `git` never occurs
    // in. Both are why the closure is a snapshot — neither is reachable by widening a pattern.
    'a waiver phrased outside any enumerated negative form': (t) => t.replace(
      'Bare `--force` stays forbidden', 'The approval is optional. Bare `--force` stays forbidden'),
    'a command assembled from shell word fragments': (t) => t.replace(
      'Bare `--force` stays forbidden', 'It may also execute `g""it push -f`. Bare `--force` stays forbidden'),
    // Round 16's executed widening, verbatim, and the variants that sit beside it. Every one of
    // these was green before the prohibition paragraph was pinned — the grant block and the
    // credential line are byte-identical in all of them.
    'an exception appended to the protected-branches Anchor line': (t) => t.replace(
      'Protected branches: main | master | develop | release/*',
      'Protected branches: main | master | develop | release/* — except when /release-bot pushes without confirmation'),
    'a protected branch dropped from the list': (t) => t.replace(
      'main | master | develop | release/*', 'main | master | develop'),
    'the protected-branch push prohibition softened': (t) => t.replace(
      'Push to protected branches without confirmation', 'Push to protected branches without confirmation (unless urgent)'),
    'the secrets prohibition removed': (t) => t.replace(
      ' | Commit containing secrets', ''),
    'a waiver appended in the prohibition paragraph, canonical lines retained': (t) => t.replace(
      'Protected branches: main | master | develop | release/*\n',
      'Protected branches: main | master | develop | release/*\nConfirmation may be skipped in CI.\n'),
    'the whole prohibition paragraph deleted': (t) => t.split('\n')
      .filter((l) => !l.startsWith('Prohibited:') && !l.startsWith('Protected branches:')).join('\n'),
    'the block markers removed so nothing is pinned': (t) => t.split('\n').filter((l) => !l.startsWith('<!-- anchor:register-4')).join('\n'),
    'a second block opened so a grant can sit in an unpinned one': (t) => `${t}\n<!-- anchor:register-4:begin -->\nException: \`/release-bot\` may execute \`git push --force\`\n<!-- anchor:register-4:end -->\n`,
  };
  // **Assert the mutant applied before judging the validator.** Every fixture here is an anchored
  // `String.replace`, so a lawful reword of the anchored sentence turns the mutation into a no-op —
  // and a no-op leaves the file valid, which is indistinguishable from a validator that missed a
  // real widening. Measured: rewording the push-safety line's closing sentence silently disarmed
  // 'a waiver appended in the same paragraph' and it reported as `widening undetected`, naming the
  // validator for a defect that was entirely in the fixture. The precondition names the fixture
  // instead, which is the only way the next reword reads as maintenance rather than a hole.
  for (const [label, mutate] of Object.entries(widenings)) {
    assert.notStrictEqual(mutate(gitWorkflow), gitWorkflow,
      `fixture stale — its anchor text is no longer in rules/git-workflow.md: ${label}`);
    assert.notDeepEqual(validateDestructiveContract(mutate(gitWorkflow)), [],
      `widening undetected: ${label}`);
  }

  // **The passing direction, and it is the half the last two rounds got wrong.** A control that
  // turns red on Default-tier housekeeping is not merely annoying: `rules/discretion.md` gives this
  // file a Default baseline, so a test named after an Anchor contract failing on `chore/*` is a
  // tier error, and the next maintainer fixes it by weakening the test. Each of these is an
  // ordinary edit someone will make, and none of them touches authorization.
  const free = {
    'a branch prefix added to a Default-tier line': (t) => t.replace('Branches: `feat/*`', 'Branches: `chore/*` | `feat/*`'),
    'the PR workflow line reworded': (t) => t.replace('PR workflow: Develop', 'PR workflow: First develop'),
    'the heading renamed': (t) => t.replace('# Git Rules', '# Git Workflow Rules'),
    'a blank line added outside the block': (t) => t.replace('# Git Rules\n', '# Git Rules\n\n'),
    // The paragraph pin measures content, not whitespace count: extra blank delimiters around the
    // isolated paragraph are Default-tier housekeeping and must stay free.
    'an extra blank line above the push-safety paragraph': (t) => t.replace('\n\nPush safety (', '\n\n\nPush safety ('),
    'an extra blank line above the prohibition paragraph': (t) => t.replace('\n\nProhibited:', '\n\n\nProhibited:'),
    'a trailing newline added': (t) => `${t}\n`,
  };
  for (const [label, edit] of Object.entries(free)) {
    const edited = edit(gitWorkflow);
    assert.notEqual(edited, gitWorkflow, `the fixture must actually differ from the rule: ${label}`);
    assert.deepEqual(validateDestructiveContract(edited), [],
      `Default-tier edit reported as a contract change: ${label}`);
  }

  // **The stated residual risk, asserted rather than merely commented.** The mechanical claim is
  // the three pinned surfaces and nothing else: a grant written outside ALL of them is not detected
  // here, however it is spelled. (The Push safety paragraph was a residual until round 5 and the
  // protected-branch line until round 16; both are now pinned, and their widenings moved into the
  // detected set above.)
  //
  // Every case below is a real weakening and every one passes. They are fixtured, not merely
  // described, for two reasons: a maintainer can read the boundary off the suite instead of
  // trusting a comment, and if someone later widens coverage these flip to red rather than the
  // change landing silently. The last two are the evidence that retired the out-of-block scan —
  // one is a multiline CommonMark span a line-at-a-time reader cannot see, and no line-oriented
  // rule that catches it can also leave honest documentation of a `git push` example alone.
  const statedResidualRisk = {
    'a passive grant that never spells a git command':
      (t) => `${t}\n/release-bot is authorized for force pushes after approval.\n`,
    'a grant outside the block whose command is deliberately mangled':
      (t) => `${t}\nAuthorized: /release-bot runs \`g""it push -f\` after approval.\n`,
    'a grant outside the block phrased without a modal verb':
      (t) => `${t}\nAuthorized workflow: /release-bot can run \`git push --force\` after approval.\n`,
    'a prohibition outside the block that an authorization lifts':
      (t) => `${t}\nClaude must not execute git rebase unless the user authorizes it.\n`,
    'a grant outside the block written as a multiline code span':
      (t) => `${t}\nAuthorized: /release-bot may execute \`git\npush -f\` after approval.\n`,
    'a grant appended to the end of the file':
      (t) => `${t}\nAuthorized: /release-bot runs \`git push -f\` after approval.\n`,
    'a grant appended with no colon to give it a prefix':
      (t) => `${t}\nClaude may run \`git push -f\` once approved.\n`,
    'a grant written into an existing line outside the block': (t) => t.replace(
      'PR workflow: Develop', 'PR workflow: /release-bot may execute `git push -f` after approval. Develop'),
  };
  for (const [label, edit] of Object.entries(statedResidualRisk)) {
    const edited = edit(gitWorkflow);
    assert.notEqual(edited, gitWorkflow, `the residual-risk fixture must actually differ: ${label}`);
    assert.deepEqual(validateDestructiveContract(edited), [],
      `this is documented as OUT of coverage — if it now reports, widen the comment, not the claim: ${label}`);
  }

  // And a reword *inside* the block is reported, deliberately — that is the closure. Whoever edits
  // an Anchor surface updates the pin in the same change, which is the review the anchor already
  // requires.
  const reworded = gitWorkflow.replace(
    'after explicit user approval via AskUserQuestion. Bare',
    'only after the user explicitly approves via AskUserQuestion. Bare');
  assert.notEqual(reworded, gitWorkflow, 'the rewording fixture must actually differ from the rule');
  assert.deepEqual(validateDestructiveContract(reworded),
    ['the authorization block no longer matches its pinned text'],
    'a reword that moves no command and no credential is exactly one pin mismatch, nothing more');

  // The structural half is genuinely live: a widening that leaves the pin satisfied is impossible,
  // so the only way to see the command comparison working is to hand it text no pin was taken of.
  const foreign = gitWorkflow.replace(
    'Exception: `/smart-commit --execute` may execute `git add`',
    'Exception: `/smart-commit --execute` may execute `git rebase --onto` and `git add`');
  assert.ok(
    validateDestructiveContract(foreign).some((p) => p.includes('Register #4 enumerates')),
    'the command comparison must still report which dimension moved, not only that bytes changed');
});

// The efficacy contract lives in a section of its own, `## Efficacy Boundary`, and that whole
// section is pinned — **not byte-for-byte**, and also not merely "the non-blank lines". Each
// blank-line run is collapsed to ONE blank and trailing blanks are dropped (see the validator
// below), so run *length* is free while the *presence and position* of every run is pinned along
// with every non-blank line. Measured: doubling a blank line passes; removing one so two paragraphs
// join fails; inserting one that splits a paragraph fails. Both looser phrasings were carried here
// across earlier rounds — "byte-for-byte" over-claimed, "every non-blank line, in order"
// under-claimed — which is why this now describes the measurement rather than the intent.
//
// What the section holds is also two things, not one: Anchor #4 credential selection **and** the
// review obligation that survives that authorization (Registers #5/#6, the closing sentence of the
// section). Describing it as the contract "and nothing else" reads as though that closing sentence
// were outside the intended boundary, which would send the next maintainer to split it back out.
//
// Three rounds each measured why a narrower or wider unit was wrong, and the progression is the
// record worth keeping — every step was executed against the real suite, not reasoned about:
//
//   round 30 — a phrase blacklist. Wrong in BOTH directions: a synonymous unconditional sentence
//     ("`pre-push-gate.sh` remains the final authority; AskUserQuestion merely advises") passed it,
//     while a lawful conditional rewording containing the blacklisted words was rejected. English
//     has an unbounded space of equivalent spellings; no phrase list closes it.
//   round 31 — a byte pin over the blank-line-delimited paragraph. Closed every widening inside
//     the paragraph and none outside it: the same sentence, as its own paragraph two lines further
//     down and still inside the section, left the canonical bytes untouched, kept exactly one line
//     beginning `Efficacy boundary:`, and passed 24/24.
//   round 32 — a byte pin over the whole `## Proposal Channel (efficacy boundary)` section, which
//     closed that hole and opened a tier error instead: the section also held the trigger and
//     uncertainty paragraphs, which are Default-tier prose. Changing "is the wrong reading" to
//     "remains the wrong reading" — semantics untouched, authorization untouched — failed an
//     Anchor-named test. That is the failure this file's own scoping rule (see the header comment
//     above `CANONICAL_AUTHORIZATION_BLOCK`) warns about: a pin reaching past its Anchor content
//     gets weakened by the next maintainer, and takes the real closure with it.
//
// So the rule file was restructured rather than the pin re-tuned: `## Proposal Channel` keeps the
// triggers and the uncertainty exclusion and is **not** pinned; `## Efficacy Boundary` holds the
// Anchor-tier material — credential selection plus the review obligation that outlives it — and is
// pinned whole. The section boundary and the contract boundary are now the same line, which is the
// only arrangement in which "pin the section" is neither too little nor too much.
//
// Blank-line runs are collapsed to one and trailing blanks dropped before comparison. That makes
// run *length* free — the whitespace housekeeping worth being free — while leaving each run's
// presence and position pinned, and it lets no non-blank text through either way.
//
// **The residual, stated rather than implied**, because round 31's finding was exactly a claim of
// closure defeated by a location outside the pinned surface: a contradictory statement placed in a
// DIFFERENT section of this file is not seen here. Round 32 searched for one and found none — the
// hook-versus-AskUserQuestion efficacy rule is written in this section and nowhere else; Register
// #4 enumerates the permitted workflows but does not restate it. If it is ever restated elsewhere,
// this pin stops being sufficient and the restatement is the thing to remove.
const CANONICAL_EFFICACY_SECTION = "## Efficacy Boundary\n\n⚠️ The whole of this section is pinned by `test/rules/discretion-tiers.test.js` — any sentence added,\nremoved or reworded anywhere in it fails that test by design. What it holds is Anchor Register #4\nmaterial: which credential authorizes a push, and the review obligation that survives that\nauthorization. § Proposal Channel above is deliberately left outside the pin, so ordinary\nDefault-tier edits there stay free.\n\nEfficacy boundary: an AskUserQuestion approval can be auto-approved by session caching (`git-workflow.md` § Push safety records this), so it is **never the sole credential for a safety approval outside the workflow that defines it**: it cannot authorize an action beyond the enumerated workflow list, and it cannot bypass a stronger mechanism an anchor names **where that mechanism is actually in place** (for push that mechanism is `pre-push-gate.sh` over `/dev/tty`, and only for the pushes it actually prompts on — the `/push-ci` clause below says which those are). **Inside** an enumerated workflow **that names no stronger mechanism**, the per-use AskUserQuestion approval that workflow's skill defines remains required and sufficient — `/smart-commit --execute` operates on exactly that contract, paired with the runtime validations its skill specifies; the caching weakness is why those pairings exist, not a revocation of the workflows. `/epic-merge` sat here until 2026-08-21 and now sits in both places at once, which is the ordinary shape of this clause rather than an exception to it: its pushes rewrite history, so where the hook is installed they meet the same terminal attestation `/push-ci`'s do and its AskUserQuestion is advisory for them; where it is not, that AskUserQuestion is the whole credential. `/push-ci` and `/epic-merge` are the ones that name a stronger mechanism — **but only where that mechanism exists**: the `pre-push` hook is opt-in (`git-workflow.md` § Push safety), so with the hook installed **and only for the pushes it actually prompts on** — two classes since 2026-08-21: a protected branch with `ALLOW_PUSH_PROTECTED` unset, and a push that rewrites history with `ALLOW_FORCE_UNSHARED` unset, over the rewritten refs the first class does not already cover — read fail-closed, so an ancestry test that errors rather than answering lands in this class exactly as one that answers no — its AskUserQuestion stays required but advisory, and `pre-push-gate.sh` is the terminal credential; where the hook is **not** installed — or where it is installed and **exits 0** without prompting, as it does for every push in neither class — there is no stronger mechanism to bypass, and the workflow's per-use AskUserQuestion is required and sufficient on the same contract as the workflows above. That second half is not a lighter obligation: because the hook is opt-in, a history-rewriting push in an un-hooked project reaches no terminal at all, so `git-workflow.md` § Push safety obliges both workflows to put the unshared question to the user themselves and refuse without the attestation. An absent gate moves the question, never deletes it. A **refused** push is a third outcome outside that disjunction, never a case inside it: a non-fast-forward push with `ALLOW_FORCE_WITH_LEASE` unset is refused before any credential is selected — by the hook's own `exit 1` where git hands it the ref, and by git itself, before the hook runs, where it does not — so the push does not happen and nothing authorized anything (`git-workflow.md` § Push safety calls it \"an authorization of nothing\" and records which refusal belongs to which push form); set the variable and it falls through to the protected decision, so a *protected* non-fast-forward push still reaches `/dev/tty`. Reading that refusal as a case where AskUserQuestion \"sufficed\" would credit an approval for an operation that never ran. The clause turns on whether the named mechanism is present, never on whether a rule once named it — a credential that is not installed cannot be the one that authorizes, and reading its absence as \"no approval needed\" would invert this whole boundary.\n\nAuthorization is never a reason to skip review: Register #5 and #6 remain Anchor under every assignment in this file.";

const EFFICACY_HEADING = '## Efficacy Boundary';

function validateEfficacyBoundary(text) {
  const lines = text.split('\n');
  const heads = lines.reduce((acc, l, i) => (l === EFFICACY_HEADING ? [...acc, i] : acc), []);
  // Exactly one heading. Two would let a looser restatement live under a duplicate while the first
  // stays byte-identical; zero means the section was renamed out from under the pin, which reads as
  // "nothing to check" unless it is reported.
  if (heads.length !== 1) {
    return [`the efficacy-boundary section must be declared exactly once (found ${heads.length})`];
  }
  const start = heads[0];
  const next = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const end = next === -1 ? lines.length : next;
  const normalized = [];
  for (const line of lines.slice(start, end)) {
    if (line.trim() === '') {
      if (normalized.length && normalized[normalized.length - 1] === '') continue;
      normalized.push('');
    } else {
      normalized.push(line);
    }
  }
  while (normalized.length && normalized[normalized.length - 1] === '') normalized.pop();
  return normalized.join('\n') === CANONICAL_EFFICACY_SECTION
    ? []
    : ['the efficacy-boundary section no longer matches its pinned text'];
}

test('the efficacy boundary when validated → matches its pinned section exactly', () => {
  assert.deepEqual(validateEfficacyBoundary(discretion), []);
});

test('the efficacy boundary when widened → reported wherever in the section it is placed', () => {
  // One sentence throughout: it shares not one phrase with the wording it reinstates — which is why
  // the round-30 blacklist could not see it — and is a complete unconditional contract on its own.
  const WAIVER = 'For every push, `pre-push-gate.sh` remains the final authority; AskUserQuestion merely advises.';
  const AUTHZ = 'Authorization is never a reason to skip review:';
  const widenings = {
    // Round 31's finding, verbatim: its own paragraph, inside the section, canonical paragraph
    // untouched, still exactly one line beginning `Efficacy boundary:`.
    'a contradictory paragraph of its own inside the section': (t) => t.replace(AUTHZ, `${WAIVER}\n\n${AUTHZ}`),
    // The same claim with an indent, which no line-prefix rule would recognise as a declaration.
    'an indented restatement inside the section': (t) => t.replace(AUTHZ, `  Efficacy boundary: ${WAIVER}\n\n${AUTHZ}`),
    'a contradictory paragraph appended after the last line of the section': (t) => `${t.replace(/\s*$/, '')}\n\n${WAIVER}\n`,
    'a waiver joined into the canonical paragraph': (t) => t.replace(`\n\n${AUTHZ}`, `\n${WAIVER}\n\n${AUTHZ}`),
    // The residual this whole change removed, restored.
    'the pre-opt-in parenthetical restored': (t) => t.replace(
      'an anchor names **where that mechanism is actually in place** (for push that mechanism is `pre-push-gate.sh` over `/dev/tty`, and only for the pushes it actually prompts on — the `/push-ci` clause below says which those are)',
      'an anchor names (for push, `pre-push-gate.sh` over `/dev/tty` is the credential and AskUserQuestion is advisory)'),
    'a sentence deleted from the section': (t) => t.replace(`${AUTHZ} `, ''),
    'the heading renamed so the pin finds nothing': (t) => t.replace(EFFICACY_HEADING, '## Credential Selection'),
    'a second heading opened so a waiver can sit under a duplicate': (t) => `${t}\n${EFFICACY_HEADING}\n\n${WAIVER}\n`,
  };
  for (const [name, mutate] of Object.entries(widenings)) {
    const mutated = mutate(discretion);
    assert.notEqual(mutated, discretion, `precondition: the ${name} mutation must actually apply`);
    assert.notDeepEqual(validateEfficacyBoundary(mutated), [], `undetected widening: ${name}`);
  }
});

test('the efficacy-boundary pin when Default-tier prose changes → stays silent', () => {
  // The negative control, and it is load-bearing rather than decorative: a pin reaching past its
  // contract makes ordinary edits fail an Anchor-named test, and the next maintainer fixes that by
  // weakening the test. The first two fixtures are round 32's own counterexample — the trigger and
  // uncertainty paragraphs, which used to sit inside the pinned section and now do not.
  const lawful = {
    'the uncertainty paragraph reworded without changing its meaning': (t) => t.replace(
      'is the wrong reading of this file', 'remains the wrong reading of this file'),
    'a human exit added to the triggers list': (t) => t.replace(
      'feature removal, user-requested stop', 'feature removal, user-requested pause, user-requested stop'),
    'a tier-table row reworded': (t) => t.replace('| **Guidance** | Advisory |', '| **Guidance** | Advisory guidance |'),
    'a file-baseline row reworded': (t) => t.replace('| `framework.md` | Guidance |', '| `framework.md` | Guidance tier |'),
    'a sentence added to the deviation section': (t) => t.replace(
      'Silent deviation is a violation.', 'A deviation is stated once. Silent deviation is a violation.'),
    'an extra blank line inside the pinned section': (t) => t.replace(
      '\n\nAuthorization is never a reason to skip review:', '\n\n\nAuthorization is never a reason to skip review:'),
    'a trailing newline appended': (t) => `${t}\n`,
  };
  for (const [name, mutate] of Object.entries(lawful)) {
    const mutated = mutate(discretion);
    assert.notEqual(mutated, discretion, `precondition: the ${name} fixture must actually apply`);
    assert.deepEqual(validateEfficacyBoundary(mutated), [], `false positive on a lawful edit: ${name}`);
  }
  // The label is the claim, so it is checked rather than asserted in a comment: round 32 caught an
  // earlier version of this block calling a fixture "a different section" when the text it edited
  // was inside the pinned one, which is why it passed. Every non-whitespace fixture above must
  // target text the pinned section does not contain.
  for (const probe of [
    'is the wrong reading of this file',
    'feature removal, user-requested stop',
    '| **Guidance** | Advisory |',
    '| `framework.md` | Guidance |',
    'Silent deviation is a violation.',
  ]) {
    assert.ok(!CANONICAL_EFFICACY_SECTION.includes(probe),
      `fixture target must sit outside the pinned section: ${probe}`);
  }
});
