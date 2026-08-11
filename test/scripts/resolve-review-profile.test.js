'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sensitivityHit, sectionIndex, changedSectionsFromDiff, baseProfile,
  groupOf, batchPlan, tierVerdict, resolvePlan, budgetFrom, DEFAULT_BUDGET,
} = require('../../scripts/resolve-review-profile');

/** The shipped config's own shape, reduced to the two rules these cases rely on. */
const SENSITIVE = {
  version: 1,
  rules: [
    { name: 'auth', include: ['auth', 'session'], exclude: ['docs', 'test'] },
    { name: 'secrets', include: ['secrets', 'credentials'], exclude: ['docs'] },
  ],
};

const BUDGET = { max_files: 12, max_bytes: 200000 };

/** A plan whose non-file inputs are fixed, so each case varies exactly one thing. */
function plan(files, overrides = {}) {
  return resolvePlan({
    tier: 'standard',
    files,
    budget: BUDGET,
    taxonomy: null,
    sensitiveConfig: SENSITIVE,
    ...overrides,
  });
}

const profileOf = (result, p) => result.files.find((f) => f.path === p).profile;
const reasonsOf = (result, p) => result.files.find((f) => f.path === p).reasons.join(' | ');

test('a shallow profile whose diff stays inside the declared sections → stays shallow', () => {
  const result = plan([{
    path: 'docs/features/auth/2-tech-spec.md',
    profile: 'implementation-sync',
    sections: ['3. Design', '4. Implementation Roadmap'],
    changed_sections: ['3. Design'],
    bytes: 12000,
  }]);

  assert.equal(profileOf(result, 'docs/features/auth/2-tech-spec.md'), 'implementation-sync');
  assert.equal(result.escalated, false, 'the whitelist covered the diff, so nothing deepened');
});

test('a shallow profile whose diff leaves the declared sections → full-design', () => {
  const result = plan([{
    path: 'docs/features/auth/2-tech-spec.md',
    profile: 'implementation-sync',
    sections: ['3. Design'],
    changed_sections: ['3. Design', '6. Risks Accepted'],
    bytes: 12000,
  }]);

  assert.equal(profileOf(result, 'docs/features/auth/2-tech-spec.md'), 'full-design');
  assert.match(reasonsOf(result, 'docs/features/auth/2-tech-spec.md'),
    /undeclared section\(s\): 6\. Risks Accepted/);
});

test('a shallow profile declaring no sections at all → full-design', () => {
  const result = plan([{
    path: 'docs/features/auth/2-tech-spec.md',
    profile: 'implementation-sync',
    changed_sections: ['3. Design'],
    bytes: 12000,
  }]);

  assert.equal(profileOf(result, 'docs/features/auth/2-tech-spec.md'), 'full-design',
    'an undeclared diff would make the request self-certifying');
  assert.match(reasonsOf(result, 'docs/features/auth/2-tech-spec.md'), /no section whitelist/);
});

test('a new file is read whole and is not escalated for having declared no sections', () => {
  const result = plan([{
    path: 'docs/features/auth/4-implementation.md',
    profile: 'implementation-sync',
    is_new: true,
    bytes: 4000,
  }]);

  const file = result.files[0];
  assert.equal(file.read, 'whole', 'every line of a new file is new');
  assert.equal(file.profile, 'implementation-sync');
});

test('a sensitive path escalates, and its exclude list still wins', () => {
  const result = plan([
    { path: 'skills/session/SKILL.md', sections: ['Workflow'], changed_sections: ['Workflow'], bytes: 900 },
    {
      path: 'docs/features/session/2-tech-spec.md',
      sections: ['3. Design'], changed_sections: ['3. Design'], bytes: 900,
    },
  ]);

  assert.equal(profileOf(result, 'skills/session/SKILL.md'), 'full-design');
  assert.match(reasonsOf(result, 'skills/session/SKILL.md'), /rule 'auth'/);
  assert.equal(profileOf(result, 'docs/features/session/2-tech-spec.md'), 'implementation-sync',
    'exclude beats include, so a doc under a session path is not a security change');
});

test('sensitivityHit distinguishes a clean miss from an unreadable config', () => {
  assert.equal(sensitivityHit('src/router/index.js', SENSITIVE), null);
  assert.equal(sensitivityHit('src/author/index.js', SENSITIVE), null,
    'matching is segment-anchored: `author` is not `auth`');
  assert.equal(sensitivityHit('src/config/credentials/load.js', SENSITIVE), 'secrets');
  assert.equal(sensitivityHit('src/auth/login.js', null), 'unknown');
  assert.equal(sensitivityHit('src/auth/login.js', { version: 2, rules: [] }), 'unknown',
    'a config this resolver cannot honour is unknown, never none');
});

test('an unreadable sensitive-paths config escalates every file', () => {
  const result = plan([{
    path: 'docs/features/auth/2-tech-spec.md',
    profile: 'living-sync',
    sections: ['A'],
    changed_sections: ['A'],
    bytes: 900,
  }], { sensitiveConfig: null });

  assert.equal(profileOf(result, 'docs/features/auth/2-tech-spec.md'), 'full-design');
  assert.match(reasonsOf(result, 'docs/features/auth/2-tech-spec.md'), /unknown is not none/);
});

test('the tier fails closed: thorough, absent and unparseable all escalate; standard does not', () => {
  assert.equal(tierVerdict('thorough').escalates, true);
  assert.equal(tierVerdict(undefined).escalates, true);
  assert.equal(tierVerdict('').escalates, true);
  assert.equal(tierVerdict('THOROUGH').escalates, true, 'a tier is a value, not a spelling of one');
  assert.equal(tierVerdict('standard').escalates, false);
  assert.equal(tierVerdict('fast').escalates, false);
});

test('a semantic security change on a generic path escalates through --tier alone', () => {
  const entry = {
    path: 'docs/features/router/2-tech-spec.md',
    profile: 'implementation-sync',
    sections: ['3. Design'],
    changed_sections: ['3. Design'],
    bytes: 5000,
  };

  assert.equal(sensitivityHit(entry.path, SENSITIVE), null, 'zero path hits, by construction');
  const escalated = plan([entry], { tier: 'thorough' });
  assert.equal(profileOf(escalated, entry.path), 'full-design');
  assert.match(reasonsOf(escalated, entry.path), /Anchor Register #3/);
  assert.equal(profileOf(plan([entry]), entry.path), 'implementation-sync',
    'the same file at standard stays shallow — the tier is what carried it');
});

test('a record keeps its exemption when another file in the same batch escalated', () => {
  const result = plan([
    {
      path: 'docs/features/auth/requests/2026-08-09-rotate-keys.md',
      changed_sections: ['Progress'], sections: ['Progress'], bytes: 3000, role: 'Work record',
    },
    {
      path: 'skills/credentials/SKILL.md',
      sections: ['Workflow'], changed_sections: ['Workflow'], bytes: 3000,
    },
  ]);

  assert.equal(profileOf(result, 'skills/credentials/SKILL.md'), 'full-design');
  assert.equal(profileOf(result, 'docs/features/auth/requests/2026-08-09-rotate-keys.md'), 'record-diff',
    'escalation is per file; a neighbour escalating does not withdraw a record\'s exemption');
  assert.equal(result.batches.length, 1, 'both still travel in one dispatch');
});

test('a doc-only change may be reviewed as living-sync; an unstated answer may not', () => {
  const entry = {
    path: 'docs/features/auth/2-tech-spec.md',
    profile: 'living-sync',
    sections: ['3. Design'],
    changed_sections: ['3. Design'],
    bytes: 9000,
  };

  assert.equal(profileOf(plan([entry], { code_changed: false }), entry.path), 'living-sync');
  assert.equal(profileOf(plan([entry]), entry.path), 'implementation-sync',
    'no claim that the change is doc-only, so it does not buy the shallower read');
  assert.equal(baseProfile('docs/features/auth/2-tech-spec.md', 'Current authority', false),
    'living-sync');
});

test('a role that owes no code alignment cannot be reviewed deeper than requested by accident', () => {
  assert.equal(baseProfile('docs/features/auth/requests/x.md', 'Work record'), 'record-diff');
  assert.equal(baseProfile('docs/features/auth/2-tech-spec.md', 'Design record'), 'record-diff');
  assert.equal(baseProfile('docs/features/auth/2-tech-spec.md', 'Current authority'), 'implementation-sync');
  assert.equal(baseProfile('skills/doc-review/SKILL.md', 'Current authority'), 'executable',
    'an instruction surface is asked whether it still executes');
  assert.equal(baseProfile('rules/auto-loop.md', 'Current authority'), 'executable');
});

test('a requested profile shallower than the role permits is raised to the role\'s', () => {
  const result = plan([{
    path: 'skills/doc-review/SKILL.md',
    profile: 'record-diff',
    sections: ['Workflow'],
    changed_sections: ['Workflow'],
    bytes: 8000,
  }]);

  assert.equal(profileOf(result, 'skills/doc-review/SKILL.md'), 'executable');
  assert.match(reasonsOf(result, 'skills/doc-review/SKILL.md'), /shallower than the role permits/);
});

test('a requested profile that is not a profile → full-design, not a silent default', () => {
  const result = plan([{
    path: 'docs/features/auth/2-tech-spec.md',
    profile: 'quick-look',
    sections: ['A'],
    changed_sections: ['A'],
    bytes: 900,
  }]);

  assert.equal(profileOf(result, 'docs/features/auth/2-tech-spec.md'), 'full-design');
  assert.match(reasonsOf(result, 'docs/features/auth/2-tech-spec.md'), /is not a profile/);
});

test('malformed role metadata escalates rather than resolving to a path default', () => {
  const result = plan([{
    path: 'docs/features/auth/2-tech-spec.md',
    classification_unknown: true,
    profile: 'implementation-sync',
    sections: ['A'],
    changed_sections: ['A'],
    bytes: 900,
  }]);

  assert.equal(profileOf(result, 'docs/features/auth/2-tech-spec.md'), 'full-design');
  assert.match(reasonsOf(result, 'docs/features/auth/2-tech-spec.md'), /classification unknown/);
});

test('a within-budget multi-doc change is exactly one batch carrying per-file profiles', () => {
  const result = plan([
    {
      path: 'docs/features/auth/2-tech-spec.md',
      profile: 'implementation-sync', sections: ['3. Design'], changed_sections: ['3. Design'], bytes: 40000,
    },
    {
      path: 'docs/features/auth/requests/2026-08-09-rotate-keys.md',
      role: 'Work record', sections: ['Progress'], changed_sections: ['Progress'], bytes: 3000,
    },
    { path: 'skills/doc-review/SKILL.md', sections: ['Workflow'], changed_sections: ['Workflow'], bytes: 8000 },
  ]);

  assert.equal(result.batches.length, 1, 'one plan, one batch, one dispatch');
  assert.deepEqual(result.warnings, [], 'a within-budget plan says nothing about splitting');
  assert.deepEqual(result.files.map((f) => f.profile),
    ['implementation-sync', 'record-diff', 'executable'], 'per-file, not one profile for the batch');
});

test('the byte boundary is inclusive: exactly the limit stays, one byte past it opens a batch', () => {
  const files = (lastBytes) => [
    { path: 'docs/features/auth/1-requirements.md', bytes: 150000 },
    { path: 'docs/features/auth/2-tech-spec.md', bytes: lastBytes },
  ];

  assert.equal(batchPlan(files(50000), BUDGET).length, 1, '200000 bytes exactly is within budget');
  assert.equal(batchPlan(files(50001), BUDGET).length, 2, 'the 200001st byte opens the next batch');
});

test('the file boundary is inclusive: 12 files stay, the 13th opens a batch', () => {
  const files = (n) => Array.from({ length: n }, (_, i) => ({
    path: `docs/features/auth/${String(i).padStart(2, '0')}-note.md`, bytes: 100,
  }));

  assert.equal(batchPlan(files(12), BUDGET).length, 1);
  assert.equal(batchPlan(files(13), BUDGET).length, 2);
  assert.deepEqual(batchPlan(files(13), BUDGET).map((b) => b.files.length), [12, 1]);
});

test('a 25-file feature folder chunks further, and the union of batches is the full set', () => {
  const files = Array.from({ length: 25 }, (_, i) => ({
    path: `docs/features/auto-loop-evolution/${String(i).padStart(2, '0')}-note.md`, bytes: 12000,
  }));

  const batches = batchPlan(files, BUDGET);

  assert.ok(batches.length > 1, 'grouping by folder alone bounds nothing');
  assert.deepEqual(batches.map((b) => b.files.length), [12, 12, 1]);
  assert.deepEqual(batches.flatMap((b) => b.files).sort(), files.map((f) => f.path).sort(),
    'never silently truncating: every changed file is in exactly one batch');
});

test('groups are emitted in path order with everything outside docs/features last', () => {
  const files = [
    { path: 'rules/auto-loop.md', bytes: 100 },
    { path: 'docs/features/zeta/2-tech-spec.md', bytes: 100 },
    { path: 'docs/features/alpha/2-tech-spec.md', bytes: 100 },
    { path: 'README.md', bytes: 100 },
  ];

  // Grouping is how an over-budget plan is cut, so the budget has to be exceeded to observe it.
  const batches = batchPlan(files, { max_files: 2, max_bytes: 200000 });

  assert.deepEqual(batches.map((b) => b.group),
    ['docs/features/alpha', 'docs/features/zeta', '(root)']);
  assert.deepEqual(batches[2].files, ['README.md', 'rules/auto-loop.md']);
  assert.equal(groupOf('docs/features/auth/requests/x.md'), 'docs/features/auth');
});

test('a single file over the byte budget is its own batch and is reported, not skipped', () => {
  const result = plan([
    { path: 'docs/features/necessity-audit/2-tech-spec.md', bytes: 428170, role: 'Design record' },
    { path: 'docs/features/necessity-audit/1-requirements.md', bytes: 5000, role: 'Design record' },
  ]);

  assert.equal(result.batches.length, 2);
  assert.deepEqual(result.batches[0].files, ['docs/features/necessity-audit/1-requirements.md']);
  assert.equal(result.batches[1].over_budget, true);
  assert.match(result.warnings.join(' | '), /over the byte budget/);
  assert.match(result.warnings.join(' | '), /not skipped/);
  assert.deepEqual(result.batches.flatMap((b) => b.files).sort(),
    ['docs/features/necessity-audit/1-requirements.md',
      'docs/features/necessity-audit/2-tech-spec.md'].sort());
});

test('an over-budget plan says so; a within-budget one stays silent', () => {
  const many = Array.from({ length: 13 }, (_, i) => ({
    path: `docs/features/auth/${String(i).padStart(2, '0')}-note.md`, bytes: 100, role: 'Design record',
  }));

  assert.match(plan(many).warnings.join(' '), /split into 2 batches/);
  assert.deepEqual(plan(many.slice(0, 12)).warnings, [],
    'a plan that fits reports nothing to report');
});

test('changed sections are resolved against the file as it stands, including a pure deletion', () => {
  const source = [
    '# Auth',
    '',
    'Preamble line.',
    '',
    '## 3. Design',
    '',
    'Design body.',
    '',
    '## 6. Risks',
    '',
    'Risk body.',
    '',
  ].join('\n');

  assert.deepEqual(changedSectionsFromDiff('@@ -7,1 +7,1 @@\n-old\n+new\n', source, source), ['3. Design']);
  assert.deepEqual(changedSectionsFromDiff('@@ -11,2 +11,0 @@\n-gone\n', source, source), ['6. Risks'],
    'a pure deletion is located on the old side, which is the only side that has those lines');
  assert.deepEqual(changedSectionsFromDiff('@@ -3,1 +3,1 @@\n-a\n+b\n', source, source), ['(preamble)']);
  assert.deepEqual(sectionIndex(source)[0], '(preamble)');

  assert.deepEqual(changedSectionsFromDiff('@@ -11,2 +11,0 @@\n-gone\n', source), [],
    'with no old side and no removed heading there is nothing to locate — a guess would be the '
    + 'neighbouring section, which is the misattribution this argument exists to prevent');
});

test('a hunk past the end of the file clamps instead of reading undefined', () => {
  const source = '# Auth\n\n## 3. Design\n\nBody.\n';
  const before = `${source}tail\ntail\ntail\n`;

  assert.deepEqual(changedSectionsFromDiff('@@ -6,3 +6,0 @@\n-tail\n-tail\n-tail\n', source, before),
    ['3. Design'], 'the tail was removed, so the last section is where it was');
  assert.deepEqual(changedSectionsFromDiff('@@ -40,3 +6,0 @@\n-tail\n', source, before),
    ['3. Design'], 'a range past the end of either side clamps rather than reading undefined');
});

test('the budget comes from the taxonomy and falls back rather than trusting a bad value', () => {
  assert.deepEqual(budgetFrom({ review_budget: { max_files: 6, max_bytes: 50000 } }),
    { max_files: 6, max_bytes: 50000 });
  assert.deepEqual(budgetFrom(null), DEFAULT_BUDGET);
  assert.deepEqual(budgetFrom({ review_budget: { max_files: 0, max_bytes: -1 } }), DEFAULT_BUDGET,
    'a budget of zero files would emit one batch per file forever');
});

test('the shipped taxonomy carries the budget this resolver documents', () => {
  const taxonomy = require('../../scripts/config/doc-taxonomy.json');

  assert.deepEqual(budgetFrom(taxonomy), { max_files: 12, max_bytes: 200000 });
  assert.ok(taxonomy.review_budget._comment.includes('inclusive'),
    'the config states the boundary rule the resolver implements');
});

// ── The default path: no producer plan at all ──────────────────────────────
// Every case above hands the resolver a producer-declared profile or whitelist. The CLI's own
// default — a bare `--files` list, which is how the skill invokes it — was untested, and under it
// every file escalated to `full-design` on "no section whitelist declared". That is the whole cost
// saving, gone, and the suite was green throughout.

test('a record with no producer plan keeps record-diff — the default path is the common path', () => {
  const result = plan([
    { path: 'docs/features/auth/requests/2026-08-09-fix-login.md', role: 'Work record',
      changed_sections: ['Progress'], bytes: 7000 },
    { path: 'docs/features/auth/2-tech-spec.md', role: 'Design record',
      changed_sections: ['3. Design'], bytes: 12000 },
  ]);

  assert.equal(profileOf(result, 'docs/features/auth/requests/2026-08-09-fix-login.md'), 'record-diff');
  assert.equal(profileOf(result, 'docs/features/auth/2-tech-spec.md'), 'record-diff');
  assert.equal(result.escalated, false,
    'nothing was claimed, so there is no claim to falsify — the role decides and the diff scopes');
});

test('a current-authority doc with no producer plan takes its role profile, not full-design', () => {
  const result = plan([{ path: 'docs/features/auth/4-implementation.md', changed_sections: ['2. Wire format'], bytes: 9000 }]);

  assert.equal(profileOf(result, 'docs/features/auth/4-implementation.md'), 'implementation-sync');
  assert.equal(reasonsOf(result, 'docs/features/auth/4-implementation.md'), '',
    'an undeclared whitelist is only a defect when a shallow profile was requested');
});

test('a declared whitelist is still checked when no profile was requested', () => {
  const result = plan([{
    path: 'docs/features/auth/4-implementation.md',
    sections: ['2. Wire format'],
    changed_sections: ['2. Wire format', '5. Rollout'],
    bytes: 9000,
  }]);

  assert.equal(profileOf(result, 'docs/features/auth/4-implementation.md'), 'full-design',
    'declaring sections is a claim about scope whether or not a profile came with it');
  assert.match(reasonsOf(result, 'docs/features/auth/4-implementation.md'), /5\. Rollout/);
});

test('read follows the resolved profile, so an escalated file reports the deeper scope', () => {
  const result = plan([
    { path: 'docs/features/auth/requests/2026-08-09-fix-login.md', role: 'Work record',
      changed_sections: ['Progress'], bytes: 7000 },
    { path: 'docs/features/auth/4-implementation.md', changed_sections: ['2. Wire format'], bytes: 9000 },
    { path: 'src/auth/2-tech-spec.md', changed_sections: ['3. Design'], bytes: 9000 },
  ]);

  const readOf = (p) => result.files.find((f) => f.path === p).read;
  assert.equal(readOf('docs/features/auth/requests/2026-08-09-fix-login.md'), 'hunks');
  assert.equal(readOf('docs/features/auth/4-implementation.md'), 'sections');
  assert.equal(readOf('src/auth/2-tech-spec.md'), 'whole',
    'the sensitive-path hit escalated it, and the read scope must say so');
});

// ── CLI level: the facts must come from git, not from the caller ───────────
// Every case above hands `resolvePlan` a pre-built entry, so `is_new`, `is_deleted`, `role` and
// `bytes` were whatever the test said they were. That is exactly the substitution the resolver must
// refuse from a producer, and it hid two defects: an untracked file got a section-scoped read over
// content that is entirely new, and a deleted file read as a classification failure.

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../../scripts/resolve-review-profile');

/** A throwaway repository with one commit, so HEAD exists and status is meaningful. */
function gitRepo(committed) {
  const root = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'rrp-cli-')));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '--initial-branch=main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  for (const [rel, body] of Object.entries(committed)) {
    const abs = nodePath.join(root, rel);
    fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  git('add', '-A');
  git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'baseline');
  return { root, write: (rel, body) => {
    const abs = nodePath.join(root, rel);
    fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }, remove: (rel) => fs.rmSync(nodePath.join(root, rel)) };
}

function runCli(argv) {
  const written = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  let code;
  try {
    code = main(argv);
  } finally {
    process.stdout.write = realWrite;
  }
  return { code, plan: JSON.parse(written.join('')) };
}

const SPEC = ['# Auth', '', '## 3. Design', '', 'text', '', '## 6. Risks', '', 'more text', ''].join('\n');

test('an untracked file is read whole — git status is asked for, not assumed', () => {
  const repo = gitRepo({ 'docs/features/auth/2-tech-spec.md': SPEC });
  repo.write('docs/features/auth/4-implementation.md', '# Impl\n\n## 1. Shipped\n\ntext\n');

  const { plan } = runCli(['--tier', 'standard', '--root', repo.root,
    '--files', 'docs/features/auth/4-implementation.md']);

  const file = plan.files[0];
  assert.equal(file.read, 'whole', 'an untracked file has no diff to scope a shallow read against');
  assert.equal(file.deleted, false);
});

test('a deleted file is classified from HEAD and read whole, not reported as unclassifiable', () => {
  const repo = gitRepo({ 'docs/features/auth/2-tech-spec.md': SPEC });
  repo.remove('docs/features/auth/2-tech-spec.md');

  const { plan } = runCli(['--tier', 'standard', '--root', repo.root,
    '--files', 'docs/features/auth/2-tech-spec.md']);

  const file = plan.files[0];
  assert.equal(file.deleted, true);
  assert.equal(file.read, 'whole', 'what is under review is everything that went away');
  assert.ok(!file.reasons.some((r) => /classification unknown/.test(r)),
    'the text still exists at HEAD, so the classification is knowable');
});

test('--plan takes the producer intent and re-derives every fact from the repository', () => {
  const repo = gitRepo({ 'docs/features/auth/2-tech-spec.md': SPEC });
  repo.write('docs/features/auth/2-tech-spec.md',
    SPEC.replace('more text', 'more text, edited outside the declared section'));
  const planFile = nodePath.join(repo.root, 'producer.json');
  fs.writeFileSync(planFile, JSON.stringify({
    tier: 'standard',
    files: [{
      path: 'docs/features/auth/2-tech-spec.md',
      profile: 'implementation-sync',
      sections: ['3. Design'],
      // Everything below is a lie the producer must not be able to tell.
      role: 'Current authority',
      bytes: 1,
      changed_sections: ['3. Design'],
      is_new: false,
    }],
  }));

  const { plan } = runCli(['--root', repo.root, '--plan', planFile]);

  const file = plan.files[0];
  assert.equal(file.profile, 'full-design',
    'the edit left the declared whitelist, and the resolver reads the diff to find that out');
  assert.match(file.reasons.join(' | '), /6\. Risks/);
  assert.notEqual(plan.batches[0].bytes, 1, 'the byte count is measured, not accepted');
});

test('deleting a whole section names that section, not its surviving neighbour', () => {
  const repo = gitRepo({ 'docs/features/auth/2-tech-spec.md': SPEC });
  repo.write('docs/features/auth/2-tech-spec.md', ['# Auth', '', '## 3. Design', '', 'text', ''].join('\n'));
  const planFile = nodePath.join(repo.root, 'producer.json');
  fs.writeFileSync(planFile, JSON.stringify({
    tier: 'standard',
    files: [{ path: 'docs/features/auth/2-tech-spec.md', profile: 'implementation-sync', sections: ['3. Design'] }],
  }));

  const { plan } = runCli(['--root', repo.root, '--plan', planFile]);

  assert.equal(plan.files[0].profile, 'full-design',
    'a pure deletion maps to the surviving neighbour, so whitelisting it must not buy a shallow read');
  assert.match(plan.files[0].reasons.join(' | '), /6\. Risks/);
});

test('a rule whose exclude is a bare string escalates instead of throwing', () => {
  const broken = { version: 1, rules: [{ name: 'auth', include: ['auth'], exclude: 'docs' }] };

  assert.equal(sensitivityHit('src/auth/login.js', broken), 'unknown',
    'fail-closed must mean escalate, not crash the process that would have escalated');
  assert.equal(sensitivityHit('src/router/index.js', broken), 'unknown',
    'a malformed rule is unknown for every path, not just the ones it would have matched');
});

test('a deletion at the top of the file is located on the old side, where it happened', () => {
  const repo = gitRepo({ 'docs/features/auth/2-tech-spec.md': SPEC });
  // Git reports this as `@@ -1,2 +0,0 @@`: the new-side location is line 0, which is no line at all.
  // Only the old side says where the removed text lived, and no heading was removed to fall back on.
  repo.write('docs/features/auth/2-tech-spec.md', SPEC.split('\n').slice(2).join('\n'));
  const planFile = nodePath.join(repo.root, 'producer.json');
  fs.writeFileSync(planFile, JSON.stringify({
    tier: 'standard',
    files: [{ path: 'docs/features/auth/2-tech-spec.md', profile: 'implementation-sync', sections: ['3. Design'] }],
  }));

  const { plan } = runCli(['--root', repo.root, '--plan', planFile]);

  assert.equal(plan.files[0].profile, 'full-design',
    'a change the new side cannot locate must not read as no change at all');
  assert.match(plan.files[0].reasons.join(' | '), /\(preamble\)/);
});

test('a zero-length side names a position, not a changed line', () => {
  const before = ['# Doc', '', '## A', '', 'a body'].join('\n');
  const source = ['# Doc', '', '## A', '', 'a body', '', '## B', '', 'b body'].join('\n');

  // A whole new section appended: git reports the old side as `-5,0`, a position sitting in A's
  // territory that holds none of the inserted lines, while every inserted line is in B. The two
  // sides therefore name *different* sections, which is what makes this a control — marking the
  // zero-length side too would escalate a correctly-whitelisted B edit, and the answer would be
  // `['A', 'B']` rather than `['B']`.
  assert.deepEqual(changedSectionsFromDiff('@@ -5,0 +7,3 @@\n+## B\n+\n+b body\n', source, before), ['B']);
});

// ── Repository facts the CLI must not get wrong ────────────────────────────

test('a staged addition is new: HEAD decides, not the index', () => {
  const repo = gitRepo({ 'docs/features/auth/2-tech-spec.md': SPEC });
  repo.write('docs/features/auth/4-implementation.md', '# Impl\n\n## 1. Shipped\n\ntext\n');
  execFileSync('git', ['add', '-A'], { cwd: repo.root, stdio: 'ignore' });

  const { plan } = runCli(['--tier', 'standard', '--root', repo.root,
    '--files', 'docs/features/auth/4-implementation.md']);

  assert.equal(plan.files[0].read, 'whole',
    '`git ls-files` says tracked the moment it is staged, and every line of it is still new');
  assert.equal(plan.files[0].deleted, false);
});

test('a read failure that is not ENOENT is unknown, not a deletion', () => {
  const { inspect } = require('../../scripts/resolve-review-profile');
  const root = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'rrp-eisdir-')));
  // A directory where a file is expected: readFileSync throws EISDIR, and the path is plainly still
  // there. Substituting HEAD text here would review content nobody touched and report it as gone.
  fs.mkdirSync(nodePath.join(root, 'present.md'));
  const git = { inHead: () => true, diff: () => '', show: () => '# Auth\n\n## 3. Design\n\nstale\n' };

  const blocked = inspect('present.md', root, null, git);
  const absent = inspect('gone.md', root, null, git);

  assert.equal(blocked.is_deleted, false, 'the file is right there — it is unreadable, not deleted');
  assert.equal(blocked.classification_unknown, true, 'and unknown is what escalates');
  assert.equal(absent.is_deleted, true, 'ENOENT with a HEAD version is the real deletion');
});

test('a git command that fails is unknown, and unknown escalates', () => {
  const { inspect } = require('../../scripts/resolve-review-profile');

  const noGit = inspect('docs/x.md', '/', null, { inHead: () => null, diff: () => null, show: () => null });

  assert.equal(noGit.classification_unknown, true,
    'git could not answer, and "could not answer" must never read as "nothing changed"');
});

test('a failed diff on a readable tracked file escalates, not just flags', () => {
  const { inspect } = require('../../scripts/resolve-review-profile');
  const root = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'rrp-nodiff-')));
  fs.mkdirSync(nodePath.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(nodePath.join(root, 'docs/x.md'), '# X\n\n## S\n\nbody\n');

  // The file reads and HEAD knows it, so every earlier return is passed: only the failed `diff`
  // decides. Asserting the flag alone would leave the escalation itself untested.
  const entry = inspect('docs/x.md', root, null,
    { inHead: () => true, diff: () => null, show: () => '# X\n\n## S\n\nold\n' });
  const resolved = plan([{ ...entry, profile: 'living-sync', sections: ['S'] }]);

  assert.equal(entry.classification_unknown, true);
  assert.equal(resolved.files[0].profile, 'full-design', 'unknown reads the whole document');
  assert.equal(resolved.files[0].read, 'whole');
});

test('a tracked file whose HEAD text cannot be read is unknown, not unchanged', () => {
  const { inspect } = require('../../scripts/resolve-review-profile');
  const root = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'rrp-noshow-')));
  fs.mkdirSync(nodePath.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(nodePath.join(root, 'docs/x.md'), '# X\n\n## S\n\nbody\n');

  // A top-of-file deletion: the new side is zero-length and correctly skipped, no `##` heading was
  // removed, so the old side is the only evidence there is. Without it `changed_sections` comes back
  // empty, which reads as "changed nothing outside the whitelist" — the cheapest possible answer to
  // a question git declined to answer.
  const entry = inspect('docs/x.md', root, null,
    { inHead: () => true, diff: () => '@@ -1,2 +0,0 @@\n-# X\n-\n', show: () => null });
  const resolved = plan([{ ...entry, profile: 'implementation-sync', sections: ['S'] }]);

  assert.equal(entry.classification_unknown, true);
  assert.deepEqual(entry.changed_sections, []);
  assert.equal(resolved.files[0].profile, 'full-design',
    'no old side means no evidence, and no evidence must not resolve shallow');
});

test('a producer cannot raise its own budget through --plan', () => {
  const files = {};
  for (let i = 0; i < 13; i += 1) files[`docs/features/auth/${i}-doc.md`] = `# D${i}\n\n## S\n\nbody\n`;
  const repo = gitRepo(files);
  const planFile = nodePath.join(repo.root, 'producer.json');
  fs.writeFileSync(planFile, JSON.stringify({
    tier: 'standard',
    budget: { max_files: 999, max_bytes: 99999999 },
    files: Object.keys(files).map((path) => ({ path })),
  }));

  const { plan } = runCli(['--root', repo.root, '--plan', planFile]);

  assert.equal(plan.budget.max_files, 12, 'the budget is policy, and policy is not producer input');
  assert.ok(plan.batches.length > 1, '13 files exceed the configured limit and must split');
});
