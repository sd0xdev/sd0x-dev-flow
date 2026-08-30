// Contract for scripts/lib/doc-metadata.js — the artifact-role resolver.
//
// The property that matters is not "every path gets the right role" but that being wrong is
// SAFE: an unrecognised path, an annotated value, a role nobody has invented yet must all land on
// `Current authority`, which owes the deepest review. Every negative case below therefore asserts
// the fallback, not an error.
//
// Contract: docs/features/doc-review-phasing/2-tech-spec.md § 3.1.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILTIN_ROLE_CONFIG,
  CONTRACT_ROLES,
  FALLBACK_ROLE,
  ROLE_TO_SET,
  loadRoleConfig,
  docRoles,
  fallbackRole,
  headLines,
  roleFromPath,
  parseDocRole,
  parseAuthorityFlag,
  resolveDocRole,
  owesCodeAlignment,
  parseDocRoleState,
} = require('../../scripts/lib/doc-metadata');

const FOUR = ['Current authority', 'Design record', 'History record', 'Work record'];

// --- The closed set -----------------------------------------------------------------------

test('the role set is exactly the four the spec names, and the fallback is the deepest one', () => {
  assert.deepEqual([...docRoles()].sort(), FOUR);
  assert.equal(FALLBACK_ROLE, 'Current authority');
  assert.equal(fallbackRole(), 'Current authority');
  // Every role maps to a source set, and the sets are distinct — `scanFeatureDocs` indexes by
  // this map, so a role with no set would silently drop documents out of every set.
  assert.deepEqual(Object.keys(ROLE_TO_SET).sort(), FOUR);
  assert.equal(new Set(Object.values(ROLE_TO_SET)).size, 4);
});

// --- The config surface ---------------------------------------------------------------------

test('the shipped taxonomy and the built-in fallback table agree', () => {
  // The built-in copy exists for a consuming repo whose doc-taxonomy.json predates § doc_roles.
  // A copy that disagrees with the shipped table would make this plugin behave one way here and
  // another way there, which is exactly the drift a second copy always produces.
  const shipped = loadRoleConfig();
  assert.notEqual(shipped, BUILTIN_ROLE_CONFIG, 'the shipped config must actually be read');
  assert.deepEqual(shipped.closed_set, BUILTIN_ROLE_CONFIG.closed_set);
  assert.equal(shipped.fallback, BUILTIN_ROLE_CONFIG.fallback);
  assert.deepEqual(
    shipped.path_defaults.map((r) => [r.name, r.role, r.scope, r.pattern]),
    BUILTIN_ROLE_CONFIG.path_defaults.map((r) => [r.name, r.role, r.scope, r.pattern])
  );
});

test('a taxonomy with no doc_roles block falls back to the built-in table, not to nothing', () => {
  // "No rules" would resolve everything to Current authority — safe, but it would silently turn
  // the whole feature off in any repo running an older config.
  assert.equal(roleFromPath('docs/features/x/2-tech-spec.md', {}), 'Design record');
  assert.equal(roleFromPath('docs/features/x/requests/a.md', {}), 'Work record');
  // intent-<key>.md is a Design record on the built-in fallback path too — without this row a
  // taxonomy shipping no doc_roles would put intent into /update-docs' rewrite path.
  assert.equal(roleFromPath('docs/features/x/intent-x.md', {}), 'Design record');
});

test('intent-<key>.md resolves to Design record from the shipped config', () => {
  assert.equal(roleFromPath('docs/features/x/intent-x.md'), 'Design record');
});

test('the intent-records rule is scoped: instruction surfaces and directory names stay out', () => {
  // Live counter-examples from this repo: instruction-surface references whose basenames start
  // with intent- must stay Current authority (the relpath rule's anchored prefix cannot match
  // a skills/** path, so the instruction-surface rule keeps them).
  assert.equal(roleFromPath('skills/req-analyze/references/intent-template.md'), 'Current authority');
  assert.equal(roleFromPath('skills/ask/references/intent-patterns.md'), 'Current authority');
  // A feature DIRECTORY named intent-<x> must not claim its descendants (.md-anchored pattern).
  assert.equal(roleFromPath('docs/features/intent-artifact/4-implementation.md'), 'Current authority');
  assert.equal(roleFromPath('docs/features/intent-artifact/2-tech-spec.md'), 'Design record');
  // Built-in fallback path agrees on all four.
  assert.equal(roleFromPath('skills/req-analyze/references/intent-template.md', {}), 'Current authority');
  assert.equal(roleFromPath('docs/features/intent-artifact/4-implementation.md', {}), 'Current authority');
});

test('a legal feature key matching a segment rule cannot steal its own intent artifact', () => {
  // SLUG_RE admits keys like `requests`, `adr-skill` (a live feature) and `4-implementation`;
  // segment-wide rules match those DIRECTORY names, so the relpath intent rule must come first
  // or the artifact lands on the wrong role — Work/History record, or worst, Current authority
  // (the /update-docs rewrite path, the exact treatment the Design-record role exists to block).
  assert.equal(roleFromPath('docs/features/requests/intent-requests.md'), 'Design record');
  assert.equal(roleFromPath('docs/features/adr-skill/intent-adr-skill.md'), 'Design record');
  assert.equal(roleFromPath('docs/features/review-log-x/intent-review-log-x.md'), 'Design record');
  assert.equal(roleFromPath('docs/features/4-implementation/intent-4-implementation.md'), 'Design record');
  // The feature-relative form (rootRelative: false callers) resolves the same way…
  assert.equal(roleFromPath('intent-adr-skill.md', undefined, { rootRelative: false }), 'Design record');
  // …and a nested requests/intent-*.md is NOT the artifact: the Work-record rule keeps it.
  assert.equal(roleFromPath('docs/features/x/requests/intent-x.md'), 'Work record');
  assert.equal(roleFromPath('requests/intent-x.md', undefined, { rootRelative: false }), 'Work record');
});

test('config cannot invent a role, and one malformed rule does not take the scan down', () => {
  const rogue = {
    doc_roles: {
      closed_set: FOUR,
      fallback: 'Whatever I Like',
      path_defaults: [
        { name: 'invented', role: 'Living document', scope: 'segment', pattern: '.*' },
        { name: 'broken', role: 'Work record', scope: 'segment', pattern: '([unclosed' },
        { name: 'valid', role: 'Design record', scope: 'segment', pattern: '^2-tech-spec' },
      ],
    },
  };
  // A role outside the closed set is skipped even though its `.*` would match everything.
  // An uncompilable pattern is skipped too, so the valid rule behind it still fires.
  assert.equal(roleFromPath('docs/features/x/2-tech-spec.md', rogue), 'Design record');
  // An unmatched path takes the fallback — and an out-of-set fallback reverts to the safe one.
  assert.equal(fallbackRole(rogue), 'Current authority');
  assert.equal(roleFromPath('docs/features/x/notes.md', rogue), 'Current authority');
});

test('the role set and the fallback are contract, so config cannot configure an exemption', () => {
  // The hole this closes: `fallback` is a *valid* member of the set, so a config naming a
  // non-authority one exempted every path that matched no rule — README.md included. And a fifth
  // configured role was exempt by construction, since owing alignment is defined as BEING
  // `Current authority`. Both are now ignored rather than honoured.
  const exempting = {
    doc_roles: {
      closed_set: [...FOUR, 'Living document'],
      fallback: 'Design record',
      path_defaults: [],
    },
  };
  assert.equal(fallbackRole(exempting), 'Current authority');
  assert.equal(roleFromPath('README.md', exempting), 'Current authority');
  assert.equal(owesCodeAlignment('README.md', undefined, exempting), true);

  // The invented role is not a member, so declaring it in a document does not exempt either.
  const declared = '# Doc\n\n> **Doc role**: Living document\n';
  assert.equal(parseDocRole(declared, exempting), null);
  assert.equal(owesCodeAlignment('README.md', declared, exempting), true);

  assert.deepEqual([...docRoles(exempting)].sort(), FOUR);
  assert.deepEqual([...CONTRACT_ROLES].sort(), FOUR);
});

// --- Path defaults ------------------------------------------------------------------------

test('request docs are work records wherever they sit, including under requests/archived/', () => {
  assert.equal(
    roleFromPath('docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity.md'),
    'Work record'
  );
  // Archiving changes visibility, not what the document is.
  assert.equal(
    roleFromPath('docs/features/customize-v2/requests/archived/2026-03-17-redesign.md'),
    'Work record'
  );
  // Feature-relative, which is the form scanFeatureDocs holds.
  assert.equal(roleFromPath('requests/2026-08-09-doc-review-cost-r2.md'), 'Work record');
});

test('review logs and ADRs are history records, by filename and by split-folder name', () => {
  assert.equal(
    roleFromPath('docs/features/stacked-pr-mode/review-log-stacked-pr-mode-r2.md'),
    'History record'
  );
  // The real split shape in this repo: a review-log-named FOLDER whose sub-files restart their
  // own numbering. Reading only the basename would classify these as `Current authority`.
  assert.equal(
    roleFromPath('docs/features/stacked-pr-mode/review-log-stacked-pr-mode-r2/review-log-rounds-38-61.md'),
    'History record'
  );
  assert.equal(roleFromPath('docs/features/hook-dedup/adr-0003-lock-ownership.md'), 'History record');
});

test('lifecycle phases 0-3 are design records, and a split one keeps its phase in the folder', () => {
  for (const p of [
    'docs/features/x/0-feasibility-study.md',
    'docs/features/x/1-requirements.md',
    'docs/features/x/2-tech-spec.md',
    'docs/features/x/3-architecture.md',
  ]) {
    assert.equal(roleFromPath(p), 'Design record', p);
  }

  // A split lifecycle doc numbers its sub-files from 1 (`@rules/docs-numbering.md` § Size Limit),
  // so `1-phase-d-hook-hardening.md` carries no phase of its own — the FOLDER does.
  assert.equal(
    roleFromPath('docs/features/necessity-audit/2-tech-spec/1-phase-d-hook-hardening.md'),
    'Design record'
  );
  assert.equal(
    roleFromPath('docs/features/auto-loop-autonomy/0-feasibility-study/2-review-intelligence.md'),
    'Design record'
  );
  // An FP brief prefixed with its parent phase is design-side too — the spec's pattern is a
  // prefix match, and this file exists in the corpus.
  assert.equal(roleFromPath('docs/features/x/2-tech-spec-fp-brief.md'), 'Design record');
});

test('4-implementation is the one lifecycle doc that IS current authority', () => {
  assert.equal(roleFromPath('docs/features/auto-loop-evolution/4-implementation.md'), 'Current authority');
  assert.equal(owesCodeAlignment('docs/features/auto-loop-evolution/4-implementation.md'), true);
});

test('instruction surfaces are current authority, but only as a repo ROOT directory', () => {
  for (const p of ['skills/feature-dev/SKILL.md', 'rules/auto-loop.md', 'agents/doc-refactor.md', 'commands/x.md']) {
    assert.equal(roleFromPath(p), 'Current authority', p);
  }
  // The shipped config cannot demonstrate `scope: first_segment` at all: the instruction-surface
  // rule is last and its role IS the fallback, so a nested `skills/` segment resolves to
  // `Current authority` either way and any fixture built on it passes for the wrong reason. The
  // scope is therefore exercised against a config where the two answers differ.
  const scoped = {
    doc_roles: {
      ...BUILTIN_ROLE_CONFIG,
      path_defaults: [{ name: 'root-only', role: 'History record', scope: 'first_segment', pattern: '^skills$' }],
    },
  };
  assert.equal(roleFromPath('skills/feature-dev/SKILL.md', scoped), 'History record');
  assert.equal(roleFromPath('docs/features/x/skills/notes.md', scoped), 'Current authority',
    'a nested `skills` segment must not match a first_segment rule');

  // The control that makes the pair mean something: the same rule widened to every segment DOES
  // match the nested path, so the assertion above is measuring scope and nothing else.
  const widened = {
    doc_roles: {
      ...BUILTIN_ROLE_CONFIG,
      path_defaults: [{ name: 'any-segment', role: 'History record', scope: 'segment', pattern: '^skills$' }],
    },
  };
  assert.equal(roleFromPath('docs/features/x/skills/notes.md', widened), 'History record');
});

test('a feature-relative path never matches a first_segment rule → its own first segment is not a root one', () => {
  // The scanner holds paths relative to `docs/features/<key>/`, so `skills/notes.md` there is a
  // folder inside one feature and `skills/notes.md` at the repo root is the instruction surface
  // the shipped rule is written for. Same string, different question — `rootRelative: false` is
  // how the caller says which one it is holding.
  const scoped = {
    doc_roles: {
      ...BUILTIN_ROLE_CONFIG,
      path_defaults: [{ name: 'root-only', role: 'History record', scope: 'first_segment', pattern: '^skills$' }],
    },
  };
  assert.equal(roleFromPath('skills/notes.md', scoped), 'History record',
    'the same string, read as repo-relative, is exactly what the rule is for');
  assert.equal(roleFromPath('skills/notes.md', scoped, { rootRelative: false }), 'Current authority');
  assert.equal(resolveDocRole('skills/notes.md', '# N\n', scoped, { rootRelative: false }), 'Current authority',
    'resolveDocRole must forward the flag, not drop it');

  // Two controls, because skipping the rule and ignoring the config are the same observation
  // otherwise. Segment-scoped rules still apply to a feature-relative path...
  const widened = {
    doc_roles: {
      ...BUILTIN_ROLE_CONFIG,
      path_defaults: [{ name: 'any-segment', role: 'History record', scope: 'segment', pattern: '^skills$' }],
    },
  };
  assert.equal(roleFromPath('skills/notes.md', widened, { rootRelative: false }), 'History record');
  // ...and omitting the flag keeps the repo-relative reading, so no existing caller changes.
  assert.equal(roleFromPath('skills/notes.md', scoped, {}), 'History record');
});

test('anything else fails closed to Current authority — including real corpus outliers', () => {
  // Phase-3 docs whose name is not `3-architecture*`. Both exist; neither matches the spec's
  // whitelist, so both owe full alignment. That is the correct outcome, not a gap.
  assert.equal(roleFromPath('docs/features/dual-reviewer/3-auto-loop-integration.md'), 'Current authority');
  assert.equal(roleFromPath('docs/features/customize-v2/3-customize-v2.md'), 'Current authority');

  assert.equal(roleFromPath('docs/features/x/briefing-recap-2026-04-17.md'), 'Current authority');
  assert.equal(roleFromPath('README.md'), 'Current authority');
  assert.equal(roleFromPath('docs/skill-catalog.yml'), 'Current authority');
  assert.equal(roleFromPath(''), 'Current authority');
  assert.equal(roleFromPath(null), 'Current authority');
  assert.equal(roleFromPath(undefined), 'Current authority');
});

// --- Metadata parsing ---------------------------------------------------------------------

const withHeader = (lines) => `# Title\n\n${lines.join('\n')}\n\n## Background\n\nProse.\n`;

test('an exact Doc role blockquote is read; the key is case-insensitive', () => {
  assert.equal(parseDocRole(withHeader(['> **Doc role**: Design record'])), 'Design record');
  assert.equal(parseDocRole(withHeader(['> **DOC ROLE**: Work record'])), 'Work record');
  assert.equal(parseDocRole(withHeader(['>  **Doc role**:   History record  '])), 'History record');
});

test('an annotated or lower-cased value does not match — it fails closed, never guessed', () => {
  // The exact failure `request-status.js` was written to prevent: commentary on a field that is
  // compared by equality. `Design record (mostly)` must NOT read as `Design record`. It does not
  // fall through to the path default either — a declaration that is present but unreadable is
  // `invalid`, and `resolveDocRole` answers `Current authority`.
  assert.equal(parseDocRole(withHeader(['> **Doc role**: Design record (mostly)'])), null);
  assert.equal(parseDocRole(withHeader(['> **Doc role**: design record'])), null);
  assert.equal(parseDocRole(withHeader(['> **Doc role**: Historical record'])), null);
  assert.equal(parseDocRole(withHeader(['> **Doc role**:'])), null);
  assert.equal(parseDocRole('# Title\n\nNo metadata at all.\n'), null);
  assert.equal(parseDocRole(''), null);
});

test('the 30-line head window caps how far the preamble may reach', () => {
  // The window is a ceiling on the preamble, not a search area — content before the block ends it
  // regardless. What the window still decides is a preamble that is itself long: a header padded
  // with blank lines, or a long run of metadata keys.
  const atEdge = `${'\n'.repeat(29)}> **Doc role**: Work record\n`;
  assert.equal(parseDocRole(atEdge), 'Work record', 'line 30 is inside the window');

  const pastEdge = `${'\n'.repeat(30)}> **Doc role**: Work record\n`;
  assert.equal(parseDocRole(pastEdge), null, 'line 31 is outside it');

  // A long metadata block is cut at the same boundary — the 31st key is not read.
  const longHeader = [
    '# Req',
    ...Array.from({ length: 29 }, (_, i) => `> **Key ${i}**: value`),
    '> **Doc role**: Work record',
  ].join('\n');
  assert.equal(parseDocRole(longHeader), null);
});

test('the authority flag parses Yes/No and refuses anything annotated', () => {
  assert.equal(parseAuthorityFlag(withHeader(['> **Current behavior authority**: Yes'])), true);
  assert.equal(parseAuthorityFlag(withHeader(['> **Current behaviour authority**: no'])), false);
  // The exact shape this repo's own r2 header carries. A prose sentence must not read as a
  // boolean — that is how a document talks its way out of a review.
  assert.equal(
    parseAuthorityFlag(withHeader(['> **Current behavior authority**: No — until Step 4 lands'])),
    null
  );
  assert.equal(parseAuthorityFlag(withHeader(['> **Current behavior authority**: true'])), null);
  assert.equal(parseAuthorityFlag('# Title\n'), null);
});

// --- Resolution and the alignment obligation ----------------------------------------------

test('metadata beats the path default, in both directions', () => {
  const specPath = 'docs/features/x/2-tech-spec.md';
  assert.equal(resolveDocRole(specPath), 'Design record');

  // A tech spec that really is the living behaviour reference declares it and is reviewed as one.
  const live = withHeader(['> **Doc role**: Current authority']);
  assert.equal(resolveDocRole(specPath, live), 'Current authority');
  assert.equal(owesCodeAlignment(specPath, live), true);

  // And the other direction: a superseded implementation record stops being authority.
  const implPath = 'docs/features/x/4-implementation.md';
  const retired = withHeader(['> **Doc role**: History record']);
  assert.equal(resolveDocRole(implPath, retired), 'History record');
  assert.equal(owesCodeAlignment(implPath, retired), false);
});

// The obligation and the source set are ONE answer. They were two in the first draft — the flag
// decided the obligation and the role decided the placement — so a tech spec declaring itself live
// owed alignment while sitting in `design_records`, where no consumer asking "what is current"
// would find it. Every case below asserts both halves together, which is what makes the class
// impossible rather than merely absent today.
test('the authority flag moves the document, not just its obligation', () => {
  const specPath = 'docs/features/x/2-tech-spec.md';
  const yes = withHeader(['> **Current behavior authority**: Yes']);
  assert.equal(resolveDocRole(specPath, yes), 'Current authority');
  assert.equal(owesCodeAlignment(specPath, yes), true);
  assert.equal(ROLE_TO_SET[resolveDocRole(specPath, yes)], 'current_authority');

  // The inverse: a superseded implementation record leaves current-behaviour sources entirely.
  const implPath = 'docs/features/x/4-implementation.md';
  const no = withHeader(['> **Current behavior authority**: No']);
  assert.equal(resolveDocRole(implPath, no), 'History record');
  assert.equal(owesCodeAlignment(implPath, no), false);
  assert.equal(ROLE_TO_SET[resolveDocRole(implPath, no)], 'history_records');
});

test('a conflicting pair resolves the safe way — promotion wins', () => {
  const specPath = 'docs/features/x/2-tech-spec.md';
  // `Doc role` says record, the flag says live. Two contradictory declarations, and the deeper
  // obligation is the one that survives.
  const conflict = withHeader([
    '> **Doc role**: Design record',
    '> **Current behavior authority**: Yes',
  ]);
  assert.equal(resolveDocRole(specPath, conflict), 'Current authority');
  assert.equal(owesCodeAlignment(specPath, conflict), true);

  // The consistent pair from the spec's own example: `Doc role` carries it, the flag agrees.
  const agreed = withHeader([
    '> **Doc role**: Design record',
    '> **Status**: Accepted',
    '> **Current behavior authority**: No',
  ]);
  assert.equal(resolveDocRole(specPath, agreed), 'Design record');
  assert.equal(owesCodeAlignment(specPath, agreed), false);
});

test('a metadata example inside a document is an example, not a declaration', () => {
  // The document most likely to contain one is the document explaining the format — so without
  // this, the spec that defines the metadata exempts itself from review by quoting itself.
  const documenting = [
    '# How to mark a document',
    '',
    'Put this at the top:',
    '',
    '```markdown',
    '> **Doc role**: Design record',
    '> **Current behavior authority**: No',
    '```',
    '',
    'That is all.',
  ].join('\n');
  assert.equal(parseDocRole(documenting), null);
  assert.equal(parseAuthorityFlag(documenting), null);
  assert.equal(resolveDocRole('docs/features/x/4-implementation.md', documenting), 'Current authority');
  assert.equal(owesCodeAlignment('docs/features/x/4-implementation.md', documenting), true);

  // Negative control — the guard must not eat real metadata that merely sits near an example, or
  // it would be green today and silently stop honouring declarations later.
  const real = [
    '# Spec',
    '',
    '> **Doc role**: Design record',
    '',
    '```bash',
    'echo hi',
    '```',
  ].join('\n');
  assert.equal(parseDocRole(real), 'Design record');
});

test('exactly the three record roles are exempt; everything unrecognised owes alignment', () => {
  assert.equal(owesCodeAlignment('docs/features/x/requests/2026-08-09-a.md'), false);
  assert.equal(owesCodeAlignment('docs/features/x/review-log-a.md'), false);
  assert.equal(owesCodeAlignment('docs/features/x/2-tech-spec.md'), false);

  assert.equal(owesCodeAlignment('rules/auto-loop.md'), true);
  assert.equal(owesCodeAlignment('docs/features/x/briefing-recap-2026-04-17.md'), true);
  assert.equal(owesCodeAlignment('some/path/nobody/planned-for.md'), true);
});

// --- The AC this feature exists for -------------------------------------------------------

test('a frozen tech spec is absent from current-behaviour sources, yet reachable for design', () => {
  const spec = 'docs/features/doc-review-phasing/2-tech-spec.md';

  // Asserted as an ABSENCE, because that is the actual requirement: research asking "what does
  // the system do now" must not be able to reach this file. A test that only checked
  // `=== 'Design record'` would still pass if the sets were wired to include it in both.
  assert.notEqual(resolveDocRole(spec), 'Current authority');
  assert.equal(owesCodeAlignment(spec), false);

  // …and still reachable for the question it CAN answer.
  assert.equal(resolveDocRole(spec), 'Design record');
  assert.equal(ROLE_TO_SET[resolveDocRole(spec)], 'design_records');
});

test('the shipped config resolves this repo\'s own documents correctly, end to end', () => {
  // Path defaults are configuration, so the config and the resolver can drift apart without any
  // unit test noticing. These are real paths in this repo.
  const cases = [
    ['rules/auto-loop.md', 'Current authority'],
    ['skills/feature-dev/SKILL.md', 'Current authority'],
    ['docs/features/auto-loop-evolution/4-implementation.md', 'Current authority'],
    ['docs/features/doc-review-phasing/2-tech-spec.md', 'Design record'],
    ['docs/features/doc-review-phasing/requests/2026-08-09-doc-review-cost-r2.md', 'Work record'],
    ['docs/features/stacked-pr-mode/review-log-stacked-pr-mode-r2/review-log-rounds-38-61.md', 'History record'],
  ];
  for (const [p, expected] of cases) {
    assert.equal(roleFromPath(p), expected, p);
  }
});

// --- The preamble contract, and what it makes unreachable ------------------------------------
//
// Metadata is the contiguous run of `> **Key**: value` lines at the very top of the document,
// after optional blank lines and at most one ATX heading. Nothing below that run is parsed, so
// no Markdown construct has to be recognised: an illustration is introduced by something —
// prose, a fence line, an HTML tag — and that something ends the preamble. Rounds 2 and 3 each
// found another shape of quoted example being read as a declaration while the reader was trying
// to classify constructs; the cases below are those same shapes, now unreachable by
// construction. Each one used to turn a `4-implementation.md` into a record and drop its
// obligation, so each keeps its own case.

test('every shape of quoted example stays out of reach, whatever encloses it', () => {
  const shapes = {
    'four-backtick fence': ['````markdown', '```', '> **Doc role**: Design record', '```', '````'],
    'info-string fence': ['```markdown', '> **Doc role**: Design record', '```js', '> **Doc role**: Work record', '```'],
    'tilde fence': ['~~~markdown', '```', '> **Doc role**: Design record', '~~~'],
    'blockquoted fence': ['> ```markdown', '> **Doc role**: Design record', '> ```'],
    'HTML comment': ['<!--', '> **Doc role**: Design record', '-->'],
    'pre block': ['<pre>', '> **Doc role**: Design record', '</pre>'],
    'div block': ['<div class="example">', '> **Doc role**: Design record', '</div>'],
    'inline-code line': ['``` `inline` ```', '> **Doc role**: Design record'],
  };
  for (const [name, body] of Object.entries(shapes)) {
    const doc = ['# How to mark a document', '', 'Put this at the top:', '', ...body].join('\n');
    assert.equal(parseDocRole(doc), null, name);
    assert.equal(resolveDocRole('docs/features/x/4-implementation.md', doc), 'Current authority', name);

    // …and the same shape with no introducing prose, since an example is not always introduced.
    const bare = ['# How to mark a document', '', ...body].join('\n');
    assert.equal(parseDocRole(bare), null, `${name} (no intro prose)`);
  }
});

test('a declaration below any other content is not honoured — the trade, asserted', () => {
  // The cost of the preamble rule, stated as a test rather than left to be discovered: this is
  // a real declaration, and it is deliberately ignored because prose precedes it. The authoring
  // contract is "put it at the top", and the reader must not be quietly widened later without
  // this case being confronted.
  const belowProse = [
    '# Spec',
    '',
    'Some introduction.',
    '',
    '> **Doc role**: Design record',
  ].join('\n');
  assert.equal(parseDocRole(belowProse), null);
  assert.equal(resolveDocRole('docs/features/x/4-implementation.md', belowProse), 'Current authority');

  // Both directions of the loss, so neither is mistaken for a fail-closed guarantee: a promotion
  // written below content is missed too, leaving the document on its path default.
  const promotionBelowFence = [
    '# Spec',
    '',
    '```markdown',
    'example content',
    '```',
    '',
    '> **Current behavior authority**: Yes',
  ].join('\n');
  assert.equal(parseAuthorityFlag(promotionBelowFence), null);
  assert.equal(resolveDocRole('docs/features/x/2-tech-spec.md', promotionBelowFence), 'Design record');

  // Negative control: the identical declarations, moved into the preamble, are both honoured —
  // so these cases prove placement is what decides, not the words.
  const atTop = ['# Spec', '', '> **Doc role**: Design record', '', 'Some introduction.'].join('\n');
  assert.equal(parseDocRole(atTop), 'Design record');
  const promotionAtTop = ['# Spec', '', '> **Current behavior authority**: Yes', '', '```md', 'x', '```'].join('\n');
  assert.equal(parseAuthorityFlag(promotionAtTop), true);
});

test('CommonMark block indentation is allowed, on the heading and on the metadata alike', () => {
  // Up to three leading spaces is still a block marker; a reader anchored on column zero drops a
  // real declaration written that way, and the loss direction is the bad one — a promotion goes
  // unread and the document stays exempt.
  const indentedHeading = ['  # Living specification', '', '> **Current behavior authority**: Yes'].join('\n');
  assert.equal(parseAuthorityFlag(indentedHeading), true);
  assert.equal(resolveDocRole('docs/features/x/2-tech-spec.md', indentedHeading), 'Current authority');

  const indentedMetadata = ['# Spec', '', '   > **Doc role**: Design record'].join('\n');
  assert.equal(parseDocRole(indentedMetadata), 'Design record');

  // Four spaces is an indented code block per CommonMark — content, not a declaration. This is the
  // negative control: without it the rule above would just be "any indent", and a code block
  // showing a declaration would grant the exemption it is only illustrating.
  const codeBlock = ['# Impl', '', '    > **Doc role**: Design record'].join('\n');
  assert.equal(parseDocRole(codeBlock), null);
  assert.equal(resolveDocRole('docs/features/x/4-implementation.md', codeBlock), 'Current authority');
});

test('a configured key is matched literally, whatever punctuation it holds', () => {
  // `_esc` escapes regex metacharacters in the configured key, but the preamble-shape gate ran
  // first and rejected any key containing `*` — so the escaping promise was unreachable for
  // exactly one character class, and the failure was a lost promotion (an exemption granted).
  const keys = ['Current *behavior* authority', 'Authority (v2)', 'Authority [live]', 'Authority+'];
  for (const authority_key of keys) {
    const cfg = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { authority_key } } };
    const doc = `# Spec\n\n> **${authority_key}**: Yes\n`;
    assert.equal(parseAuthorityFlag(doc, cfg), true, authority_key);
    assert.equal(resolveDocRole('docs/features/x/2-tech-spec.md', doc, cfg), 'Current authority', authority_key);
  }

  // The control: literally means literally. A document using the key as a regex — `Authority.` is
  // what `Authority+` would match if `+` were live — must not satisfy the configured key.
  const cfg = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { authority_key: 'Authority+' } } };
  assert.equal(parseAuthorityFlag('# Spec\n\n> **AuthorityY**: Yes\n', cfg), null);
  assert.equal(parseAuthorityFlag('# Spec\n\n> **Authority**: Yes\n', cfg), null);

  // The same for the role key, since both travel the identical path.
  const roleCfg = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { role_key: 'Doc *role* key' } } };
  assert.equal(parseDocRole('# Spec\n\n> **Doc *role* key**: Work record\n', roleCfg), 'Work record');
});

test('a lone asterisk is a character; two are the delimiter, and prose does not become a key', () => {
  // The regression the widening bought before it was narrowed: `.+?` backtracks across `**`, so a
  // prose blockquote parsed as one long key, stayed inside the preamble, and let the declaration
  // below it be read — an exemption granted by a sentence.
  const prose = ['# Implementation', '', '> **Note** and **more**: text', '> **Doc role**: Design record'].join('\n');
  assert.equal(parseDocRole(prose), null);
  assert.equal(owesCodeAlignment('docs/features/x/4-implementation.md', prose), true);

  // The control that keeps the narrowing honest — the punctuated key above must still work, and it
  // is the same line shape minus the embedded delimiter pair.
  const cfg = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { authority_key: 'Current *behavior* authority' } } };
  assert.equal(parseAuthorityFlag('# Spec\n\n> **Current *behavior* authority**: Yes\n', cfg), true);
});

test('a key that cannot be written in the format fails the whole document closed', () => {
  // `**` inside a key collides with the delimiter around it, a trailing `*` runs into it, and a
  // line terminator cannot occur on one line at all. Two milder policies were rejected because
  // both leave the same hole: matching nothing, and substituting the built-in key, each drop
  // every promotion written the configured way. So an unusable key means declarations are
  // unreadable, and an unreadable declaration cannot be the basis of an exemption — every
  // document goes to the deepest obligation, which is also loud enough to notice.
  const unusable = ['Really **bold** authority', 'Authority*', 'Live\nauthority', 'Live\rauthority', '', 42, {}];
  for (const authority_key of unusable) {
    const cfg = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { authority_key } } };
    const label = JSON.stringify(authority_key);
    // A request ticket: a path default that would normally exempt it outright.
    assert.equal(resolveDocRole('docs/features/x/requests/2026-08-09-a.md', '# Req\n', cfg), 'Current authority', label);
    assert.equal(owesCodeAlignment('docs/features/x/2-tech-spec.md', '# Spec\n', cfg), true, label);
    // And the built-in key is not quietly honoured in its place.
    assert.equal(parseAuthorityFlag('# Spec\n\n> **Current behavior authority**: Yes\n', cfg), null, label);
  }

  // Two negative controls, or the rule above would be indistinguishable from "config breaks
  // everything". A usable custom key replaces the built-in one and works…
  const usable = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { authority_key: 'Live authority' } } };
  assert.equal(parseAuthorityFlag('# Spec\n\n> **Current behavior authority**: Yes\n', usable), null);
  assert.equal(parseAuthorityFlag('# Spec\n\n> **Live authority**: Yes\n', usable), true);
  assert.equal(resolveDocRole('docs/features/x/requests/2026-08-09-a.md', '# Req\n', usable), 'Work record');

  // …and an *unset* key is not a broken one: it means "use the documented default".
  const unset = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { head_lines: 30 } } };
  assert.equal(parseAuthorityFlag('# Spec\n\n> **Current behavior authority**: Yes\n', unset), true);
  assert.equal(resolveDocRole('docs/features/x/requests/2026-08-09-a.md', '# Req\n', unset), 'Work record');

  // The role key is validated on the same terms, and it too fails the whole document closed.
  const badRole = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { role_key: 'Doc **role**' } } };
  assert.equal(parseDocRole('# Spec\n\n> **Doc role**: Work record\n', badRole), null);
  assert.equal(resolveDocRole('docs/features/x/requests/2026-08-09-a.md', '# Req\n', badRole), 'Current authority');
});

test('a raw template at the top of a document is read as a declaration — the residual, pinned', () => {
  // The one shape the preamble rule cannot exclude: a blockquote is both the declaration syntax
  // and a way to display one, so a template placed where a header goes IS a header. Asserted so
  // the hole is a known contract with a stated mitigation ("show templates inside a fence"), not
  // something a later reader discovers. If this ever starts returning null, the rule changed.
  const template = [
    '# Metadata template',
    '',
    '> **Doc role**: Design record',
    '> **Current behavior authority**: No',
    '',
    'Copy the lines above into your document.',
  ].join('\n');
  assert.equal(parseDocRole(template), 'Design record');
  assert.equal(owesCodeAlignment('docs/features/x/4-implementation.md', template), false);

  // The mitigation, asserted alongside it so the pair documents what to do instead.
  const fenced = [
    '# Metadata template',
    '',
    '```markdown',
    '> **Doc role**: Design record',
    '> **Current behavior authority**: No',
    '```',
  ].join('\n');
  assert.equal(parseDocRole(fenced), null);
  assert.equal(owesCodeAlignment('docs/features/x/4-implementation.md', fenced), true);
});

test('the preamble tolerates the shapes a real document arrives in', () => {
  // CRLF, no leading heading, blank lines above the block, and trailing whitespace all occur in
  // this repo's own files; any of them silently ending the preamble would drop real metadata.
  const crlf = ['# Doc', '', '> **Doc role**: Design record', '', 'Prose.'].join('\r\n');
  assert.equal(parseDocRole(crlf), 'Design record');

  const noHeading = '> **Doc role**: Work record\n\n# Doc\n';
  assert.equal(parseDocRole(noHeading), 'Work record');

  const padded = ['', '', '# Doc', '', '> **Doc role**: Design record   ', ''].join('\n');
  assert.equal(parseDocRole(padded), 'Design record');

  // A second heading is content, not part of the preamble — one heading is the whole allowance.
  const twoHeadings = ['# Doc', '', '## Section', '', '> **Doc role**: Design record'].join('\n');
  assert.equal(parseDocRole(twoHeadings), null);
});

// --- Duplicate and contradictory declarations (round 2) --------------------------------------

test('any Yes promotes, in either spelling and in any order', () => {
  // Reading only the first match meant a `No` above a `Yes`, or the American spelling above the
  // British one, decided — so the documented promotion rule turned on line order.
  const noThenYes = '# Doc\n\n> **Current behavior authority**: No\n> **Current behaviour authority**: Yes\n';
  assert.equal(parseAuthorityFlag(noThenYes), true);
  assert.equal(resolveDocRole('docs/features/x/2-tech-spec.md', noThenYes), 'Current authority');

  const yesThenNo = '# Doc\n\n> **Current behavior authority**: Yes\n> **Current behavior authority**: No\n';
  assert.equal(parseAuthorityFlag(yesThenNo), true);

  // Negative control: two agreeing `No`s still mean No.
  const bothNo = '# Doc\n\n> **Current behavior authority**: No\n> **Current behaviour authority**: No\n';
  assert.equal(parseAuthorityFlag(bothNo), false);
});

test('two different declared roles contradict, so neither is honoured', () => {
  const doc = '# Doc\n\n> **Doc role**: Design record\n> **Doc role**: Work record\n';
  assert.equal(parseDocRole(doc), null);
  assert.equal(parseDocRoleState(doc).state, 'invalid');
  // Fails closed, the same treatment an annotated value gets — and on a path whose default is
  // ALREADY `Current authority`, so the next assertion carries the load.
  assert.equal(resolveDocRole('docs/features/x/4-implementation.md', doc), 'Current authority');
  assert.equal(resolveDocRole('2-tech-spec.md', doc), 'Current authority',
    'a path default of `Design record` must be overridden, not fallen back to');

  // Negative control: a repeated identical declaration is not a contradiction.
  const repeated = '# Doc\n\n> **Doc role**: Design record\n> **Doc role**: Design record\n';
  assert.equal(parseDocRole(repeated), 'Design record');
});

// --- `No` demotes, it does not re-categorise (round 2) ---------------------------------------

test('a standalone No leaves an already-record document in its own set', () => {
  // The failure this prevents: a request ticket carrying `No` left `work_records`, so a consumer
  // looking for active work stopped finding it and would open a duplicate ticket.
  const no = '# Req\n\n> **Current behavior authority**: No\n';
  const reqPath = 'docs/features/x/requests/2026-08-09-a.md';
  assert.equal(resolveDocRole(reqPath, no), 'Work record');
  assert.equal(ROLE_TO_SET[resolveDocRole(reqPath, no)], 'work_records');

  const specPath = 'docs/features/x/2-tech-spec.md';
  assert.equal(resolveDocRole(specPath, no), 'Design record');

  // …and it still demotes what it is for: a path that would otherwise be current authority.
  assert.equal(resolveDocRole('docs/features/x/4-implementation.md', no), 'History record');
  assert.equal(resolveDocRole('rules/auto-loop.md', no), 'History record');
});

// --- Shape of the metadata line itself ---------------------------------------------------------

test('a line that only resembles metadata does not end the preamble by accident', () => {
  // The preamble reads a *shape*, so what that shape excludes is load-bearing. An annotated value
  // is not a clean declaration and fails closed — but it must not take the clean declarations
  // above it down with it.
  const trailing = '# Spec\n\n> **Doc role**: Design record <!-- yes, really -->\n';
  assert.equal(parseDocRoleState(trailing).state, 'invalid',
    'a trailing comment changes the value, so the declaration is present but unreadable');

  // A blockquote line that is not a key/value pair ends the preamble, since it is prose. Asserted
  // on the STATE, not on `parseDocRole() === null`: that compatibility API collapses `absent` and
  // `invalid`, so it passed here for the wrong reason while the mention scanner read on through
  // prose and called this document garbled.
  const quotedProse = ['# Spec', '', '> Note: this is a spec.', '> **Doc role**: Design record'].join('\n');
  assert.equal(parseDocRoleState(quotedProse).state, 'absent',
    'the declaration sits below the preamble, so it is absent — not unreadable');
  assert.equal(resolveDocRole('2-tech-spec.md', quotedProse), 'Design record',
    'absent means the path default, and the path default here is not the fail-closed role');

  // …but an unrelated key sitting among the declarations is just another metadata line, and the
  // block continues through it. Requests and specs in this repo all carry Status and Created.
  const mixed = [
    '# Req',
    '',
    '> **Status**: In Progress',
    '> **Created**: 2026-08-09',
    '> **Doc role**: Work record',
  ].join('\n');
  assert.equal(parseDocRole(mixed), 'Work record');
});

test('head_lines must be a positive integer, or the safe default applies', () => {
  // `Number(x) || 30` accepted 0.5, which made slice(0, 0.5) keep nothing — a first-line
  // promotion vanished and the document stayed exempt. A config that can hide metadata is a
  // config that can grant an exemption.
  const doc = '> **Current behavior authority**: Yes\n# Spec\n';
  for (const bad of [0.5, -5, 0, Infinity, NaN, '30', null, undefined]) {
    const cfg = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { head_lines: bad } } };
    assert.equal(headLines(cfg), 30, `head_lines: ${String(bad)}`);
    assert.equal(parseAuthorityFlag(doc, cfg), true, `head_lines: ${String(bad)}`);
  }
  // A valid custom value is still honoured.
  const tight = { doc_roles: { ...BUILTIN_ROLE_CONFIG, metadata: { head_lines: 1 } } };
  assert.equal(headLines(tight), 1);
  assert.equal(parseAuthorityFlag('# Spec\n> **Current behavior authority**: Yes\n', tight), null);
});

test('a Windows-style path resolves the same as a posix one', () => {
  // The scan builds relative paths with `path.join`, so on Windows they arrive here with
  // backslashes. Split on `/` alone, `requests\\archived\\old.md` is ONE segment: it never matches
  // the exact `^requests$` rule and falls through to the fallback role. The fallback is the DEEPER
  // obligation, so the bug was safe-direction — and still wrong, because the ticket then shows up
  // in `current_authority` instead of `work_records`. Portability is fixed here rather than in the
  // scanner: changing what the scanner returns would be an output-schema change.
  assert.equal(roleFromPath('requests\\archived\\old.md'), 'Work record');
  assert.equal(roleFromPath('requests\\2026-01-01-a.md'), 'Work record');
  assert.equal(roleFromPath('docs\\features\\x\\4-implementation.md'), 'Current authority');
  // The posix control: same answers, so the test cannot pass by the separator being ignored.
  assert.equal(roleFromPath('requests/archived/old.md'), 'Work record');
  assert.equal(roleFromPath('docs/features/x/4-implementation.md'), 'Current authority');
  // And the negative control: a segment that merely CONTAINS the word is not a match.
  assert.equal(roleFromPath('my-requests-notes.md'), 'Current authority');
});

test('parseDocRoleState separates absent from unreadable', () => {
  // `parseDocRole` cannot express the difference — it returns null for both — which is why the
  // resolver needed the tri-state. Pinned directly so the distinction cannot be quietly collapsed.
  assert.deepEqual(parseDocRoleState('# T\n\n## Body\n'), { state: 'absent', role: null });
  assert.deepEqual(parseDocRoleState('# T\n\n> **Doc role**: Work record\n'),
    { state: 'valid', role: 'Work record' });
  for (const bad of ['Frozen record', '', 'Work record (mostly)']) {
    assert.equal(parseDocRoleState(`# T\n\n> **Doc role**: ${bad}\n`).state, 'invalid', bad);
  }
  assert.equal(
    parseDocRoleState('# T\n\n> **Doc role**: Work record\n> **Doc role**: History record\n').state,
    'invalid');
});

test('a BOM does not hide the preamble from either reader', () => {
  assert.equal(parseAuthorityFlag('\uFEFF# T\n\n> **Current behavior authority**: Yes\n'), true);
  assert.equal(parseDocRole('\uFEFF# T\n\n> **Doc role**: Work record\n'), 'Work record');
  // Control: without the BOM the same documents already worked, so the assertions above are not
  // passing because the reader ignores the leading line entirely.
  assert.equal(parseAuthorityFlag('# T\n\n> **Current behavior authority**: Yes\n'), true);
  // And a BOM in front of a document with no preamble is still no preamble.
  assert.equal(parseDocRole('\uFEFF# T\n\n## Body\n'), null);
});

test('a preamble line that names the role key but misses the grammar is unreadable, not absent', () => {
  // The strict value reader rejects these, and rejection used to mean `absent` — which handed the
  // document its PATH default. For a tech spec that default is `Design record`, so omitting a
  // colon bought a shallower review than writing no declaration at all.
  for (const line of [
    '> **Doc role** Work record',      // no colon
    '> *Doc role*: Work record',       // one asterisk, not the bold delimiter
    '> **Doc role: Work record',       // bold run never closed
    '>   **Doc role**  Current authority',
    // Combined omissions. Requiring a `*` or `:` immediately after the key read all three as
    // ABSENT, so the boundary lookahead (whitespace, `*`, `:`, or end of line) is what these pin —
    // reverting it to a required delimiter turns them green-to-red.
    '> **Doc role Work record',        // closing bold and colon both dropped
    '> *Doc role Work record',         // and with one asterisk
    '> **Doc role',                    // key alone, end of line
    // The closing `**` in the wrong place. These are the ones the "different key" exclusion let
    // through: the bold phrase parses as a well-formed key named `Doc role Work record`, and
    // excluding it resolved a tech spec to `Design record` off a misplaced delimiter. Deleting the
    // prefix test in `_headKeyMentions` turns these two red.
    '> **Doc role Work record**:',
    '> **Doc role Current authority**: yes',
  ]) {
    assert.equal(parseDocRoleState(`# T\n\n${line}\n`).state, 'invalid', line);
    assert.equal(resolveDocRole('2-tech-spec.md', `# T\n\n${line}\n`), 'Current authority', line);
  }
});

test('a document that never names the role key is absent — the negative control', () => {
  // Without these, the test above would pass if every document were classified `invalid`.
  for (const [label, src] of [
    ['no preamble at all', '# T\n\n## Body\n'],
    ['a preamble with other keys', '# T\n\n> **Status**: Draft\n> **Scope**: x\n'],
    ['the key named in prose below the preamble', '# T\n\n## Body\n\nThe **Doc role** field.\n'],
    // The other side of the prefix rule: `Doc roleplay` does not begin with `Doc role` PLUS a
    // boundary, so it is an unrelated key and stays absent. Without this, "treat any line starting
    // with the key as a mention" would pass every assertion above.
    ['a longer word starting with the key', '# T\n\n> **Doc roleplay**: Work record\n'],
    ['the key quoted inside another key\'s value', '# T\n\n> **Note**: see **Doc role**: x\n'],
  ]) {
    assert.equal(parseDocRoleState(src).state, 'absent', label);
    assert.equal(resolveDocRole('2-tech-spec.md', src), 'Design record', label);
  }
});

test('a malformed declaration is caught whichever side of a valid one it sits', () => {
  // The first version consulted the near-miss detector only when the strict reader found NOTHING,
  // so one good line masked a bad one and the same two lines resolved differently depending on
  // their order. Both orders asserted, because either alone is satisfiable by the old code.
  const good = '> **Doc role**: Work record';
  const bad = '> **Doc role** History record';
  for (const [label, block] of [['valid first', `${good}\n${bad}`], ['malformed first', `${bad}\n${good}`]]) {
    assert.equal(parseDocRoleState(`# T\n\n${block}\n`).state, 'invalid', label);
    assert.equal(resolveDocRole('2-tech-spec.md', `# T\n\n${block}\n`), 'Current authority', label);
  }
  // The control: the good line alone is still read, so the rule is not "two lines means invalid".
  assert.deepEqual(parseDocRoleState(`# T\n\n${good}\n`), { state: 'valid', role: 'Work record' });
});

test('the near-miss detector does not fire on a key that merely looks like the configured one', () => {
  // Unanchored and without a boundary after the key, both of these forced `Current authority` on
  // documents that declared no role at all — a fail-CLOSED bug, which is the kind that hides.
  for (const line of [
    '> **Doc roleplay**: Work record',              // longer key, same prefix
    '> **Note**: Use **Doc role**: Work record here', // the key quoted mid-line, not in key position
    '> **Doc**: role',                              // shorter key
  ]) {
    assert.equal(parseDocRoleState(`# T\n\n${line}\n`).state, 'absent', line);
    assert.equal(resolveDocRole('2-tech-spec.md', `# T\n\n${line}\n`), 'Design record', line);
  }
});
