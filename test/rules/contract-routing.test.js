'use strict';

// Routing tests for the on-demand contracts (rules-residency, tech spec § 6).
//
// The residency split trades one failure mode for another. Resident prose cannot be forgotten by a
// dispatcher, only diluted; an on-demand contract can be *unreachable* — pointed at by nothing, or
// pointed at through a path or a `§` heading that no longer exists. Both directions fail silently:
// the session simply proceeds without the procedure and nothing says so. So both are asserted here.
//
//   forward  — every FULLY-QUALIFIED `rules/*.md` or `skills/*/references/*.md` citation resolves
//              to a real file AND a real heading in it. Catches the move that repointed nothing.
//
// What it does NOT cover, stated because a test name is read as a guarantee: bare-basename
// citations (`(auto-loop.md § Tiers)`), `skills/*/SKILL.md § …` targets, and the markdown-link
// form `[`x.md`](x.md) (§ H)` the README rows use. Counting bare basenames is itself
// method-dependent — 77, 41 or 36 over this scan set depending on whether a backtick or a single
// space is required — so the honest statement is the shape, not a total: roughly an eighth of the
// `§` occurrences here are validated. Widening to bare basenames needs a unique-basename index to
// resolve against, a larger change than this one; until then the boundary is documented, not
// implied.
//   backward — every registered contract is reachable from its declared activation source. Catches
//              the contract that exists but that no rule or skill will ever cause to be loaded.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, writeFileSync, mkdtempSync } = require('node:fs');
const { resolve, relative } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const { owesCodeAlignment } = require('../../scripts/lib/doc-metadata.js');

const root = resolve(__dirname, '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// The registry is the contract between the resident layer and the on-demand layer. A new contract
// is added here with its activation source, or the backward test does not cover it.
const CONTRACTS = [
  {
    path: 'skills/codex-code-review/references/scope-contract.md',
    // Both activation paths of tech spec § 3.3 that are static enough to pin: the resident rule
    // (for an ad-hoc session that dispatched no skill) and the owning skill's own manifest.
    activatedBy: ['rules/scope-discipline.md', 'skills/codex-code-review/SKILL.md'],
    // Headings other files reference by `§`; each must survive in the contract.
    headings: ['Scope Baseline', 'Scope Determination', 'Behavior Table', 'Opportunistic Envelope',
      'Records', 'Closed-Set Options', 'Helper-Sweep Ban', 'Circuit Breaker', 'Gate Derivation',
      'Human Exits', 'Anchor Compatibility'],
    minHeadings: 11,
  },
  {
    path: 'skills/codex-code-review/references/loop-diagnostics.md',
    activatedBy: ['rules/auto-loop.md', 'skills/codex-code-review/SKILL.md'],
    headings: ['Stall Detection', 'Cap Diagnostic Protocol',
      'Attention-Diffusion Subtypes and the Banking Sequence'],
    minHeadings: 3,
  },
];

// Files that may carry a reference: tracked, **plus untracked-but-not-ignored**. Tracked-only was
// a hole exactly the size of this change — a new contract is untracked until it is committed, so
// the guard could not see the two files the change adds. Measured: a dangling citation planted
// inside `scope-contract.md` left all three tests green. `--others --exclude-standard` is the same
// tracked ∪ untracked-unignored union the scope baseline uses, and it still excludes the ignored
// scratch files that were the reason to reach for `ls-files` in the first place.
function scannedMarkdown() {
  const ls = (args) => execFileSync('git', ['-C', root, 'ls-files', '-z', ...args, '*.md'],
    { encoding: 'utf8' }).split('\0').filter(Boolean);
  return [...new Set([...ls([]), ...ls(['--others', '--exclude-standard'])])]
    .filter((p) => p.startsWith('rules/') || p.startsWith('skills/') || p.startsWith('agents/')
      || p === 'CLAUDE.md' || p === 'CLAUDE.template.md' || /^README(\.[\w-]+)?\.md$/.test(p)
      // `docs/` is in scope only where the document is current authority. A record states a point
      // in time, so a citation going stale in one is the record working; repointing it would
      // destroy the only copy (`rules/docs-numbering.md`, `skills/update-docs` § Step 1.5).
      // Classified mechanically — the two reviewers of this change disagreed by hand, one calling
      // four records current-authority and the other calling three current-authority docs records.
      || (p.startsWith('docs/') && owesCodeAlignment(p)));
}

// `skills/<x>/references/<y>.md` optionally followed by ` § Heading`. The heading runs to the end
// of the markdown phrase — a backtick, comma, semicolon, close paren, or end of line.
//
// The optional closing backtick is the whole reason this half of the test does any work. Every
// citation in this repo writes the path inside code ticks — `` `skills/…/x.md` § Heading `` — so a
// pattern demanding whitespace straight after `.md` captured a heading from 0 of 57 references,
// and the heading check below was skipped on every one of them. The `§`-through-the-scanner
// control at the bottom is what keeps that from happening again silently.
// Left boundary is load-bearing: without it `skills/install-rules/SKILL.md` matches the substring
// `rules/SKILL.md` and the guard reports a file that was never cited. `agents/` is a citation
// SOURCE (see the scan set) but never a target — agent prompts are not contracts, and treating
// them as targets flagged the `agents/foo.md` placeholder in safe-remove's example table.
const REF = /(?<![\w/.-])(rules\/[\w.-]+\.md|skills\/[\w.-]+\/references\/[\w.-]+\.md)`?(?:\s+§\s+([^`,;)\n]+(?:\n[^`,;)\n]+)?))?/g;


// A cited `§ Heading` and the heading it names rarely match byte for byte, and the three ways they
// differ are all legitimate — so the matcher has to know them or it flags every real citation:
//
//   level        `### Degradation Matrix` is cited as `§ Degradation Matrix`
//   qualifier    `## Closed-Set Options (human exit E1)` is cited as `§ Closed-Set Options`
//   trailing     an unquoted citation runs into the sentence: `§ Review Loop — Thread Rotation`,
//                `§ Degradation Matrix.` — there is no delimiter saying where the heading stopped
//
// So compare on the heading's leading words: a citation matches when it BEGINS with a real
// heading, at a word boundary. The known cost: a short heading (`Records`) also matches a longer
// citation that merely begins with it — deliberate, since the alternative flags every real
// citation, and a guard that cries wolf gets deleted.
//
// The reverse direction — accepting a citation that is a *prefix* of a heading — was removed: it
// let `§ Gate`, `§ Scope` and `§ Records of Everything` all pass. Its one legitimate case was a
// citation wrapped across two lines (`§ Degradation\nMatrix`), which the capture now handles
// directly, so nothing real depends on the loose branch any more.
const headingBase = (h) => h.replace(/\s*[(—].*$/, '').trim();
const headingsOf = (body) => body.split('\n')
  .filter((l) => /^#{2,4}\s/.test(l))
  .map((l) => headingBase(l.replace(/^#{2,4}\s+/, '')));
// A boundary is "anything that is not more of the same word". Enumerating punctuation was wrong
// in two measured ways: a possessive (`§ Cap Diagnostic Protocol's`) and an agglutinative particle
// (`§ Review Dispatch가` in README.ko.md) both continue the phrase without any listed character.
// Negating the Latin word class covers both and still rejects `§ Recordsx`.
const boundary = (rest) => rest === '' || !/^[A-Za-z0-9-]/.test(rest);
const headingMatches = (cited, body) => {
  const flat = cited.replace(/\s+/g, ' ').trim();
  return headingsOf(body).some((a) => a !== ''
    && flat.startsWith(a) && boundary(flat.slice(a.length)));
};

/**
 * The scanner — the single implementation the forward test and its controls both run.
 *
 * It was briefly two: the controls held a copy of this loop, so weakening the real one left them
 * green and the control proved nothing about the guard it was written for. `rules/testing.md`
 * § Guards states the test for that ("delete the guard — if every existing case stays green, it
 * has no negative control"), and a copied loop fails it just as a claim-keyed locator does.
 */
/**
 * Is `path` reachable from `src`? The one implementation test 2 and its control both run.
 *
 * Two spellings count, because both are real citations. An outside file writes the repo-rooted
 * path; a skill citing a reference it OWNS writes the sibling form `references/<file>.md`, which
 * is the house style in `SKILL.md`. Demanding the long form there would force a skill to spell its
 * own file differently from its four neighbours to satisfy a test — a guard shaping prose rather
 * than checking it. The sibling form is only honoured when `src` actually owns `path`.
 */
const reachable = (src, path) => {
  const body = read(src);
  if (body.includes(path)) return true;
  const owner = path.replace(/\/references\/[^/]+$/, '');
  return src.startsWith(`${owner}/`) && body.includes(path.slice(owner.length + 1));
};

const RECORD_LINE = /^\s*\[(DEVIATION|USER_SKIPPED|OUT_OF_SCOPE_DEFERRED|NIT_DEFERRED|REVIEWER_FALLBACK|THREAD_ROTATED|OPPORTUNISTIC_BUDGET|OPPORTUNISTIC_FIX|OPPORTUNISTIC_DEFERRED)\]/;

// The RECORD_LINE alternatives only matter if `scan` actually excludes such a line. A record whose
// prose happens to carry a `path § heading` shape would otherwise be reported as a dangling
// citation — and adding a token without an exclusion test is how that regression ships green.
// Both directions, on the real function: the record is excluded, an ordinary line is not.
test('record lines when scanned → the three opportunistic tokens are excluded, ordinary prose is not', () => {
  const citation = 'skills/codex-code-review/references/scope-contract.md § No Such Heading';
  for (const token of ['OPPORTUNISTIC_BUDGET', 'OPPORTUNISTIC_FIX', 'OPPORTUNISTIC_DEFERRED']) {
    const record = `[${token}] key=x | reason=closed | see ${citation} | 2026-09-02T00:00:00Z`;
    assert.deepEqual(scan(record), [],
      `a [${token}] record must be excluded from citation scanning`);
  }
  // Positive control: the same citation outside a record line still reports, so the exclusion is
  // doing the work rather than the scanner having stopped resolving anything.
  const problems = scan(`Ordinary prose citing ${citation}.`);
  assert.equal(problems.length, 1, 'a dangling citation in ordinary prose must still be reported');
  assert.match(problems[0], /No Such Heading/);
});

function scan(text) {
  const problems = [];
  // Record-convention lines carry a `rule=<path> § <clause>` field whose `§` names a clause in
  // prose, not a heading. Scanning them reports a dangling citation for a line that never cited.
  const cited = text.split('\n').filter((l) => !RECORD_LINE.test(l)).join('\n');
  for (const m of cited.matchAll(REF)) {
    const [, target, heading] = m;
    if (!existsSync(resolve(root, target))) { problems.push(`missing file: ${target}`); continue; }
    if (!heading) continue;
    if (!headingMatches(heading.trim(), read(target))) {
      problems.push(`missing heading: ${target} § ${heading.trim()}`);
    }
  }
  return problems;
}

test('contract references when scanned → every fully-qualified path resolves and its § heading exists', () => {
  const dangling = scannedMarkdown()
    .flatMap((file) => scan(read(file)).map((p) => `${file} → ${p}`));
  assert.deepEqual(dangling, [], `dangling contract references:\n${dangling.join('\n')}`);
});

test('registered contracts when checked → each exists and is reachable from its activation source', () => {
  // Completeness floor on the hand-maintained registry — the same manually-kept-list failure that
  // produced this change's last two blocking findings. Emptying `headings`, dropping an entry, or
  // shrinking `activatedBy` to one source all previously survived.
  assert.ok(CONTRACTS.length >= 2, 'both extracted contracts must stay registered');
  for (const c of CONTRACTS) {
    assert.ok(c.activatedBy.length >= 2,
      `${c.path} must record both activation paths (resident rule + owning skill)`);
    // Exact floor, not a nominal one: a shared `>= 2` let seven of nine registered headings be
    // dropped, and `Helper-Sweep Ban` has no other guard in the repo — so registry entry and
    // section could be deleted together with nothing red.
    assert.ok(c.headings.length >= c.minHeadings,
      `${c.path} must register at least ${c.minHeadings} headings; got ${c.headings.length}`);
    // …and derivation, so the registry cannot silently lag the file it guards: every `## ` in the
    // contract must be registered. Floor + derivation together are what make deleting a section
    // and its registry entry in one edit detectable.
    const h2 = read(c.path).split('\n').filter((l) => l.startsWith('## '))
      .map((l) => headingBase(l.slice(3)));
    const unregistered = h2.filter((h) => !c.headings.some((r) => h.startsWith(r)));
    assert.deepEqual(unregistered, [],
      `${c.path} has headings no registry entry covers: ${unregistered.join(', ')}`);
    assert.ok(existsSync(resolve(root, c.path)), `${c.path} is registered but does not exist`);
    for (const src of c.activatedBy) {
      assert.ok(reachable(src, c.path),
        `${src} must name ${c.path}, or an ad-hoc session can never load it`);
    }
    const body = read(c.path);
    for (const h of c.headings) {
      assert.ok(headingMatches(h, body),
        `${c.path} must keep a "${h}" heading — other files cite it by that name`);
    }
  }
});

// ── Negative controls ────────────────────────────────────────────────────────────────────────
// Both directions must actually fail on the defect they claim to catch. Without these the two
// tests above are green on the day they land and stay green through the move that breaks routing.

test('routing guards when mutated → the scanner itself catches a planted dangling citation', () => {
  const contract = CONTRACTS[0].path;
  const scratch = mkdtempSync(resolve(tmpdir(), 'contract-routing-'));

  // Precondition: the citation style this repo actually uses must yield a heading capture at all.
  assert.deepEqual(scan(`See \`${contract}\` § Gate Derivation for the matrix.`), [],
    'a real citation in this repo\'s backticked style must parse and resolve');

  // negative control 1 — a heading that does not exist, written the way citations are really written
  assert.deepEqual(scan(`See \`${contract}\` § This Heading Does Not Exist.`),
    [`missing heading: ${contract} § This Heading Does Not Exist.`],
    'a dangling § citation in backticked style must be caught');

  // negative control 2 — a path that does not exist
  assert.deepEqual(scan('See `skills/codex-code-review/references/no-such-contract.md` § X.'),
    ['missing file: skills/codex-code-review/references/no-such-contract.md'],
    'a dangling path must be caught');

  // negative control 3 — the `rules/*.md` half of REF, which does most of the guard's work
  // (424 of 523 path references) and which every earlier fixture left untested: deleting that
  // alternative from the pattern left the whole suite green.
  assert.deepEqual(scan('See `rules/auto-loop.md` § No Such Heading.'),
    ['missing heading: rules/auto-loop.md § No Such Heading.'],
    'a dangling § citation against a rules/ file must be caught');
  assert.deepEqual(scan('See `rules/auto-loop.md` § Tiers.'), [],
    'a real rules/ citation must resolve');

  // scan-set membership — asserted through `scannedMarkdown()` itself, so reverting it to
  // tracked-only, or dropping the `docs/` clause, turns this red. Both mutations previously left
  // every test green while the comments claimed the opposite.
  const scanned = new Set(scannedMarkdown());
  assert.ok(scanned.has('skills/codex-code-review/references/scope-contract.md'),
    'an untracked contract must be scanned — it is untracked until the change is committed');
  assert.ok(scanned.has('docs/features/auto-loop-autonomy/4-implementation.md'),
    'a current-authority doc must be scanned — this is where round 3\'s dangling citations lived');
  assert.ok(![...scanned].some((f) => f.includes('/requests/')),
    'a record must NOT be scanned — repointing a record destroys the only copy of what it states');
  // …and the remaining source classes, each of which was silently droppable. `rules/` most of all:
  // the premise of this change is that rule files point at contracts, so narrowing the scan to
  // exclude them would disable the guard's main job with nothing going red.
  for (const required of ['rules/scope-discipline.md', 'CLAUDE.md', 'CLAUDE.template.md',
    'README.md', 'agents/strict-reviewer.md']) {
    assert.ok(scanned.has(required), `${required} must be in the scan set`);
  }

  // boundary — the check that stops a heading matching a longer word. `() => true` left it green.
  const contractBody = read(contract);
  assert.ok(headingMatches('Records', contractBody), 'control precondition: a real heading matches');
  assert.ok(!headingMatches('Recordsx', contractBody),
    'a citation continuing the word must not match — this is what `boundary` is for');
  assert.ok(!headingMatches('Record', contractBody),
    'a citation that is a PREFIX of a heading must not match — the removed loose branch');
  assert.ok(!headingMatches('Gate', contractBody), '`§ Gate` must not match `Gate Derivation`');
  // …and the heading-LINE filter, distinct from `boundary`. Asserted on the candidate SET, not on
  // one citation: without `/^#{2,4}\s/` every body line becomes a candidate, and the first
  // attempt at this control picked a citation that failed to match under the mutation too — green
  // for the wrong reason, which is the defect this whole file keeps relearning.
  const candidates = headingsOf(contractBody);
  assert.ok(candidates.length > 5, 'control precondition: the contract has real headings');
  // The empty-base guard is fail-open protection: a heading whose base reduces to '' (e.g.
  // `## (deprecated)`) would make `flat.startsWith('')` universally true and disable the forward
  // guard entirely. Assert no candidate is empty rather than trusting the `a !== ''` filter.
  assert.ok(!candidates.includes(''), 'an empty heading base would match every citation');
  // boundary must reject a continuation by digit or hyphen too, not only by letter.
  for (const near of ['Recordsx', 'Records2', 'Records-2']) {
    assert.ok(!headingMatches(near, contractBody), `\`§ ${near}\` must not match \`Records\``);
  }
  assert.ok(candidates.length < 30,
    `only heading lines may be candidates; got ${candidates.length} — the /^#{2,4}\\s/ filter is not applied`);

  // positive control — prose using the same vocabulary but citing nothing yields no edge, and is
  // asserted in ISOLATION. Appending it to a document that already contains the path (the first
  // version) made the assertion true no matter what the prose said.
  assert.deepEqual(scan('A contract may be referenced by § heading; scope-contract and'
    + ' loop-diagnostics are the two the review plane loads.'), [],
    'ordinary prose about contracts must not be read as a routing edge');

  // backward direction — driven through `reachable`, the function test 2 actually calls. The
  // previous control asserted on a local String#replace result, so neutering test 2's check left
  // it green: a control for a code path it never executed.
  const src = CONTRACTS[0].activatedBy[0];
  assert.ok(reachable(src, contract), 'control precondition: the guard names its contract today');
  const stripped = `${scratch}/stripped.md`;
  writeFileSync(stripped, read(src).split(contract).join('the review contract'));
  // `src` here is a rules file, which cannot use the sibling form — so stripping the repo-rooted
  // path is sufficient to make it unreachable, and the assertion below is not weakened by the
  // owner-relative branch above.
  assert.ok(!reachable(relative(root, stripped), contract),
    'reachability must fail for a source whose pointer was stripped');
  // …and the ownership guard on the sibling form. Without it any file mentioning
  // `references/<name>.md` would claim reachability to a contract it does not own.
  const foreign = `${scratch}/foreign.md`;
  writeFileSync(foreign, 'This file merely mentions references/loop-diagnostics.md in passing.\n');
  assert.ok(!reachable(relative(root, foreign), 'skills/codex-code-review/references/loop-diagnostics.md'),
    'a non-owning source must not reach a contract through the sibling form');
});
