const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const SKILL = resolve(ROOT, 'skills/ask/SKILL.md');
const INTENT_REF = resolve(ROOT, 'skills/ask/references/intent-patterns.md');
const ROUTING_REF = resolve(ROOT, 'skills/ask/references/routing-table.md');

// --- SKILL.md structure ---

test('ask SKILL.md exists with valid frontmatter', () => {
  assert.ok(existsSync(SKILL), 'SKILL.md should exist');
  const content = readFileSync(SKILL, 'utf8');
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fm, 'should have frontmatter');
  assert.match(fm[1], /name:\s*ask/, 'name should be ask');
  assert.match(fm[1], /description:/, 'should have description');
  assert.match(fm[1], /allowed-tools:/, 'should have allowed-tools');
});

test('ask SKILL.md has Trigger section', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /## Trigger/, 'should have Trigger section');
  assert.match(content, /ask/i, 'should include ask keyword');
});

test('ask SKILL.md has When NOT to Use section with routing', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /When NOT to Use/, 'should have When NOT to Use');
  assert.match(content, /\/feature-dev/, 'should route to feature-dev');
  assert.match(content, /\/codex-review-fast/, 'should route to codex-review-fast');
  assert.match(content, /\/review-spec/, 'should route to review-spec');
  assert.match(content, /\/codex-review-doc/, 'should route to codex-review-doc');
  assert.match(content, /\/bug-fix/, 'should route to bug-fix');
  assert.match(content, /\/next-step/, 'should route to next-step');
  assert.match(content, /\/deep-research/, 'should route to deep-research');
  assert.match(content, /\/code-explore/, 'should route to code-explore');
});

test('ask SKILL.md has Phase 0-4 workflow', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /Phase 0/i, 'should have Phase 0');
  assert.match(content, /Phase 1/i, 'should have Phase 1');
  assert.match(content, /Phase 2/i, 'should have Phase 2');
  assert.match(content, /Phase 3/i, 'should have Phase 3');
  assert.match(content, /Phase 4/i, 'should have Phase 4');
});

test('ask SKILL.md has intent classification covering 7 types', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /Intent Classification/, 'should have intent classification');
  assert.match(content, /`code`/, 'should have code intent');
  assert.match(content, /`git`/, 'should have git intent');
  assert.match(content, /`docs`/, 'should have docs intent');
  assert.match(content, /`rules`/, 'should have rules intent');
  assert.match(content, /`skill`/, 'should have skill intent');
  assert.match(content, /`arch`/, 'should have arch intent');
  assert.match(content, /`multi`/, 'should have multi intent');
});

// --- Read-only enforcement ---

test('ask SKILL.md has read-only enforcement with prohibited commands', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /Read-Only Enforcement/, 'should have read-only section');
  assert.match(content, /git add/, 'should list git add as prohibited');
  assert.match(content, /git commit/, 'should list git commit as prohibited');
  assert.match(content, /git push/, 'should list git push as prohibited');
});

test('ask SKILL.md allowed-tools does not contain Edit or Write', () => {
  const content = readFileSync(SKILL, 'utf8');
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const tools = fm[1];
  assert.ok(!tools.includes('Edit'), 'allowed-tools should not contain Edit');
  assert.ok(!tools.includes('Write'), 'allowed-tools should not contain Write');
  assert.ok(!tools.includes('NotebookEdit'), 'allowed-tools should not contain NotebookEdit');
});

// --- Path security ---

test('ask SKILL.md has path security section', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /Path Security/, 'should have path security section');
  assert.match(content, /\.env/, 'should mention .env skip');
  assert.match(content, /REDACTED/, 'should mention redaction');
});

// --- Provenance ---

test('ask SKILL.md output format has file/commit/command evidence types', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /\| file \|/, 'should have file evidence type');
  assert.match(content, /\| commit \|/, 'should have commit evidence type');
  assert.match(content, /\| command \|/, 'should have command evidence type');
});

// --- Conversation context ---

test('ask SKILL.md has conversation context integration', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /Conversation Context/i, 'should have conversation context section');
  assert.match(content, /prior/i, 'should mention prior conversation turns');
});

// --- Feature-first doc discovery ---

test('ask SKILL.md docs intent uses canonical_docs before glob fallback', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /canonical_docs/, 'should reference canonical_docs for feature-first lookup');
  assert.match(content, /fallback.*Glob|Glob.*fallback/i, 'should mention glob as fallback only');
});

// --- Routing behavior ---

test('ask SKILL.md routing suggests rather than auto-redirects', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /suggest|建議/i, 'should suggest routing');
  assert.match(content, /not auto-redirect|do not auto/i, 'should explicitly prohibit auto-redirect');
});

// --- Untracked file fallback ---

test('ask SKILL.md has untracked file fallback for feature detection', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /[Uu]ntracked.*fallback|fallback.*untracked/i, 'should have untracked file fallback');
});

// --- Size ---


// --- Verification ---

test('ask SKILL.md has Verification section', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /## Verification/, 'should have Verification section');
  assert.match(content, /\[ \]/, 'should have checklist items');
});

// --- Reference files ---

test('ask references/intent-patterns.md exists', () => {
  assert.ok(existsSync(INTENT_REF), 'intent-patterns.md should exist');
  const content = readFileSync(INTENT_REF, 'utf8');
  assert.match(content, /Intent/, 'should contain intent patterns');
});

test('ask references/routing-table.md exists', () => {
  assert.ok(existsSync(ROUTING_REF), 'routing-table.md should exist');
  const content = readFileSync(ROUTING_REF, 'utf8');
  assert.match(content, /Routing/, 'should contain routing rules');
});

// --- Catalog registration ---

test('docs/skill-catalog.yml registers /ask', () => {
  const content = readFileSync(resolve(ROOT, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/ask$/m, '/ask must be registered in the skill catalog');
});

// --- Regression guard: `context: fork` breaks conversation continuity ---
//
// /ask's Phase 1.1 ("Conversation Context Integration") reads prior conversation
// turns to disambiguate the user's question. `context: fork` would launch the
// skill in an isolated subagent that cannot see parent chat history, silently
// breaking that feature. This guard forbids any top-level `context` key in the
// frontmatter so /ask always runs in the parent session.

test('ask frontmatter must not declare any `context` key (fork breaks conversation continuity)', () => {
  const content = readFileSync(SKILL, 'utf8').replace(/\r\n/g, '\n');
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fm, 'ask/SKILL.md missing frontmatter');
  // Match any top-level `context` key variant: plain, quoted, with/without
  // space before `:`. Anchored to column 0 so nested content inside block
  // scalars (e.g. a `description: |` that happens to mention "context:") is
  // ignored — skill frontmatter only uses flat top-level keys in this repo.
  const hasContextKey = /^["']?context["']?\s*:/m.test(fm[1]);
  assert.strictEqual(
    hasContextKey,
    false,
    'skills/ask/SKILL.md must not declare any `context` key — /ask must run in the parent session so Phase 1.1 "review prior conversation turns" is achievable (forked subagents cannot see parent chat history)'
  );
});
