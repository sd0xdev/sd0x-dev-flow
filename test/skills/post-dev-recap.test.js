// Integration tests for /post-dev-recap wrapper skill.
// Contract-level / structural assertions against the skill definition
// and prompt; no real LLM or network dispatch is executed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const SKILL = resolve(REPO, 'skills', 'post-dev-recap', 'SKILL.md');
const SKILL_MIRROR = resolve(REPO, '.claude', 'skills', 'post-dev-recap', 'SKILL.md');

// --- Foundation ---

test('skill directory exists at canonical path (mirror checked only if locally bootstrapped)', () => {
  // Canonical `skills/` is tracked; `.claude/skills/` is gitignored and only
  // exists after local bootstrap (symlink via /project-setup). Follow the
  // same guarded-mirror pattern as recap-doc.test.js and recap-ask.test.js.
  assert.ok(existsSync(SKILL), 'skills/post-dev-recap/SKILL.md must exist');
  if (existsSync(SKILL_MIRROR)) {
    assert.ok(true, '.claude/skills/post-dev-recap/SKILL.md mirror present (local bootstrap)');
  }
});

test('SKILL.md has the required orchestrator sections', () => {
  const content = readFileSync(SKILL, 'utf8');
  const required = [
    '## Trigger',
    '## When NOT to Use',
    '## Command Signature',
    '## Prohibited Actions',
    '## Workflow',
    '## Q&A Gate',
    '## Path Security',
    '## Output Format',
    '## Verification',
    '## References',
    '## Examples',
  ];
  for (const heading of required) {
    assert.match(
      content,
      new RegExp(heading.replace(/[()/]/g, '\\$&'), 'm'),
      `SKILL.md must include heading: ${heading}`,
    );
  }
});

test('SKILL.md frontmatter declares required tools for orchestration', () => {
  const content = readFileSync(SKILL, 'utf8');
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, 'SKILL.md must begin with YAML frontmatter');
  const block = fm[1];
  assert.match(block, /allowed-tools:.*Bash\(node:\*\)/, 'frontmatter must allow Bash(node:*) for detect-scope.js');
  assert.match(block, /allowed-tools:.*Bash\(git:\*\)/, 'frontmatter must allow Bash(git:*) for git rev-parse + status');
  assert.match(block, /allowed-tools:.*Skill/, 'frontmatter must allow Skill tool for sub-skill dispatch');
  assert.match(block, /allowed-tools:.*AskUserQuestion/, 'frontmatter must allow AskUserQuestion for --interactive');
});

// --- AS-1: wrapper chains T1 → T2 → T3 ---

test('SKILL.md declares Phase 1 detect-scope, Phase 2 /recap-doc, Phase 3 /recap-ask (AS-1)', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(
    content,
    /Phase 1[\s\S]*?detect-scope\.js/i,
    'Phase 1 must invoke scripts/detect-scope.js',
  );
  assert.match(
    content,
    /Phase 2[\s\S]*?\/recap-doc/,
    'Phase 2 must invoke /recap-doc',
  );
  assert.match(
    content,
    /Phase 3[\s\S]*?\/recap-ask/,
    'Phase 3 must invoke /recap-ask',
  );
});

test('Phase ordering is strictly T1 → T2 → T3 (Phase 1 detect-scope before Phase 2 recap-doc before Phase 3 recap-ask)', () => {
  // AS-1 is about correct chain. Anti-regression: ensure no Phase reorders the
  // sub-skill invocations (e.g. calling /recap-ask before /recap-doc).
  const content = readFileSync(SKILL, 'utf8');
  const p1 = content.search(/### Phase 1\b/);
  const p2 = content.search(/### Phase 2\b/);
  const p3 = content.search(/### Phase 3\b/);
  assert.ok(p1 >= 0 && p2 >= 0 && p3 >= 0, 'All three Phase sections must exist');
  assert.ok(p1 < p2, 'Phase 1 must appear before Phase 2');
  assert.ok(p2 < p3, 'Phase 2 must appear before Phase 3');
  // Detect-scope must be invoked inside Phase 1 body (between ### Phase 1 and ### Phase 2).
  // Ignore earlier mermaid-diagram mentions; require at least one in-body mention.
  const phase1Body = content.slice(p1, p2);
  assert.match(
    phase1Body,
    /detect-scope\.js/,
    'detect-scope.js invocation must appear in Phase 1 body (between Phase 1 and Phase 2 headers)',
  );
});

// --- AS-2: focus passthrough ---

test('SKILL.md passes <focus> argument through to /recap-doc --focus (AS-2)', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(
    content,
    /--focus\s+(<focus>|["']?[\$]?focus)/i,
    'Phase 2 must forward --focus to /recap-doc',
  );
  // Also: signature must accept positional <focus>
  const sig = content.match(/## Command Signature[\s\S]*?(?=\n## )/);
  assert.ok(sig, 'Command Signature section must exist');
  assert.match(sig[0], /\[<focus>\]/, 'Signature must list [<focus>] as an optional positional');
});

// --- FR-4 Must: Q&A is mandatory ---

test('SKILL.md declares FR-4 Must — no --no-qa flag, Phase 3 always runs in non-interactive mode', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /FR-4 Must/, 'Must cite FR-4 Must explicitly');
  assert.match(
    content,
    /no.*--no-qa|no `--no-qa` flag|no\s+`--no-qa`/i,
    'Must state that --no-qa flag is deliberately absent',
  );
  // Q&A gate section must exist with rationale
  const gate = content.match(/## Q&A Gate \(FR-4 Must\)[\s\S]*?(?=\n## )/);
  assert.ok(gate, 'Q&A Gate section must exist');
  assert.match(gate[0], /without bypass|No bypass|always runs/i, 'Gate must state non-interactive has no bypass');
});

// --- AS-4: non-interactive auto-enters Q&A after doc ---

test('Workflow shows non-interactive path automatically dispatches to /recap-ask after /recap-doc (AS-4)', () => {
  const content = readFileSync(SKILL, 'utf8');
  // Look for mermaid workflow sequence: recap-doc → recap-ask
  const workflow = content.match(/```mermaid[\s\S]*?```/);
  assert.ok(workflow, 'Workflow must include a mermaid diagram');
  const diagram = workflow[0];
  assert.match(diagram, /recap-doc/, 'Workflow references /recap-doc');
  assert.match(diagram, /recap-ask/, 'Workflow references /recap-ask');
  // And Phase 3 entry
  assert.match(
    content,
    /### Phase 3[\s\S]*?\/recap-ask/,
    'Phase 3 dispatches to /recap-ask',
  );
});

test('Phase 3 collects first question before invoking /recap-ask (contract with sub-skill signature)', () => {
  const content = readFileSync(SKILL, 'utf8');
  const phase3 = content.match(/### Phase 3[\s\S]*?(?=\n### |\n## )/);
  assert.ok(phase3, 'Phase 3 section must exist');
  const body = phase3[0];
  // Must mention AskUserQuestion for first question (or equivalent free-text prompt)
  assert.match(
    body,
    /AskUserQuestion|第一個問題|first question/i,
    'Phase 3 must collect a first question before invoking /recap-ask (sub-skill requires <question> positional arg)',
  );
  // Must invoke /recap-ask with a question argument (not just --context)
  // Pattern: `/recap-ask` followed by a non-flag token (quoted string or placeholder) before `--context`
  assert.match(
    body,
    /\/recap-ask\s+["'<$][^\n]*--context/,
    'Phase 3 must pass <question> as first positional argument to /recap-ask',
  );
});

// --- AS-7: --interactive per-step AskUserQuestion ---

test('SKILL.md --interactive flag triggers AskUserQuestion with the 4-option set (AS-7)', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(
    content,
    /--interactive[\s\S]*?AskUserQuestion/i,
    '--interactive must trigger AskUserQuestion',
  );
  // Opt-in, not default
  const sig = content.match(/## Command Signature[\s\S]*?(?=\n## )/)[0];
  assert.match(sig, /--interactive.*\bfalse\b/i, '--interactive default must be false (opt-in)');
  // Ticket AS-7 mandates all 4 options (繼續/提問/跳段/結束) on BOTH interactive hooks
  // (between Phase 1↔2 and Phase 2↔3), not just somewhere in the file.
  const required = ['繼續', '提問', '跳段', '結束'];
  // Phase 1 interactive hook — extract the "4. **Interactive hook (opt-in)**" list item
  const phase1Hook = content.match(
    /### Phase 1[\s\S]*?Interactive hook[\s\S]*?(?=\n### Phase 2)/,
  );
  assert.ok(phase1Hook, 'Phase 1 interactive hook paragraph must exist');
  for (const opt of required) {
    assert.match(
      phase1Hook[0],
      new RegExp(opt),
      `Phase 1 interactive hook must include "${opt}" option (AS-7)`,
    );
  }
  // Phase 2 interactive hook — extract the "4. **Interactive hook**" list item
  const phase2Hook = content.match(
    /### Phase 2[\s\S]*?Interactive hook[\s\S]*?(?=\n### Phase 3)/,
  );
  assert.ok(phase2Hook, 'Phase 2 interactive hook paragraph must exist');
  for (const opt of required) {
    assert.match(
      phase2Hook[0],
      new RegExp(opt),
      `Phase 2 interactive hook must include "${opt}" option (AS-7)`,
    );
  }
  // The ask branch must be documented (not just named)
  assert.match(
    content,
    /ask[\s\S]*?(prompt|clarifying question)/i,
    'The "ask" option must document its behavior (clarifying question, not a Q&A turn)',
  );
});

// --- AS-6: no git mutations ---

test('SKILL.md Prohibited Actions explicitly forbids git add / commit / push / stash / reset (AS-6)', () => {
  const content = readFileSync(SKILL, 'utf8');
  const prohibited = content.match(/## Prohibited Actions[\s\S]*?(?=\n## )/);
  assert.ok(prohibited, 'Prohibited Actions section must exist');
  const section = prohibited[0];
  for (const cmd of ['git add', 'git commit', 'git push', 'git stash', 'git reset']) {
    assert.match(section, new RegExp(cmd), `Prohibited Actions must list ${cmd}`);
  }
  // Cross-reference to git-workflow rule
  assert.match(section, /@rules\/git-workflow\.md|git-workflow/i, 'Must cross-reference @rules/git-workflow.md');
});

// --- Scope-fail path: ⚠️ Need Human + fallback_trace ---

test('SKILL.md scope-fail path emits ⚠️ Need Human + fallback_trace (AS-6 exit)', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(
    content,
    /source === null|source == null|files\.length === 0/,
    'Must check for source===null or files.length===0',
  );
  assert.match(
    content,
    /⚠️ Need Human[\s\S]*?fallback_trace/,
    '⚠️ Need Human output must include fallback_trace',
  );
  // And the scope-fail output stub — extract from ## Output Format to ## Verification
  // (not the first \n## because code fences inside the section also start with ##).
  const outputSection = content.match(
    /## Output Format[\s\S]*?(?=\n## Verification|\n## Performance|\n## Path Security)/,
  );
  assert.ok(outputSection, 'Output Format section must exist and terminate at next top-level heading');
  assert.match(
    outputSection[0],
    /Scope-fail output|⚠️ Need Human[\s\S]*?fallback/i,
    'Output Format must include a scope-fail stub showing ⚠️ Need Human + fallback',
  );
});

// --- AS-5: When NOT to Use compares /ask, /tech-brief, /fp-brief, /code-explore ---

test('SKILL.md When NOT to Use compares /ask, /tech-brief, /fp-brief, /code-explore (AS-5 / FR-5)', () => {
  const content = readFileSync(SKILL, 'utf8');
  const whenNot = content.match(/## When NOT to Use[\s\S]*?(?=\n## )/);
  assert.ok(whenNot, 'When NOT to Use section must exist');
  const section = whenNot[0];
  for (const alt of ['/ask', '/tech-brief', '/fp-brief', '/code-explore']) {
    assert.match(
      section,
      new RegExp(alt.replace('/', '\\/')),
      `When NOT to Use must mention ${alt}`,
    );
  }
  // Plus positioning matrix (AS-5 asks for explicit contrast)
  assert.match(content, /Positioning vs/i, 'Must include a positioning comparison');
});

// --- Signature flag coverage ---

test('SKILL.md signature rejects unknown --depth values', () => {
  const content = readFileSync(SKILL, 'utf8');
  // Phase 0 must validate depth
  assert.match(
    content,
    /Validate\s+`?--depth`?[\s\S]*?brief[\s\S]*?normal[\s\S]*?deep/i,
    'Phase 0 must validate --depth ∈ {brief, normal, deep}',
  );
});

// --- Path security: git repo boundary ---

test('SKILL.md enforces git repo boundary via git rev-parse --show-toplevel', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(
    content,
    /git rev-parse --show-toplevel/,
    'Wrapper must resolve CWD via git rev-parse --show-toplevel',
  );
  assert.match(
    content,
    /must run inside a git repository|outside a git repo|not run inside a git repo/i,
    'Must refuse to run outside a git repo',
  );
});

// --- Reuse anchors present ---

test('SKILL.md References section includes T1/T2/T3 reuse anchors (NFR-5)', () => {
  const content = readFileSync(SKILL, 'utf8');
  const refs = content.match(/## References[\s\S]*?(?=\n## )/);
  assert.ok(refs, 'References section must exist');
  const section = refs[0];
  assert.match(section, /detect-scope\.js/, 'References T1 scope detector');
  assert.match(section, /@skills\/recap-doc/, 'References T2 /recap-doc');
  assert.match(section, /@skills\/recap-ask/, 'References T3 /recap-ask');
  assert.match(section, /@rules\/git-workflow\.md/, 'References git-workflow rule (AS-6)');
});

// --- Interactive skip path (skip-qa-end) ---

test('SKILL.md documents the skip-qa-end option as the only FR-4 bypass', () => {
  const content = readFileSync(SKILL, 'utf8');
  // Mentioned in Phase 2 interactive hook
  assert.match(content, /skip-qa-end/i, 'skip-qa-end option must be named');
  // Documented as an explicit-consent bypass
  const gate = content.match(/## Q&A Gate \(FR-4 Must\)[\s\S]*?(?=\n## )/)[0];
  assert.match(
    gate,
    /--interactive[\s\S]*?skip-qa-end|skip-qa-end[\s\S]*?explicit/i,
    'Q&A Gate must tie skip-qa-end to --interactive mode only',
  );
});

// --- Examples cover happy path + scope-fail ---

test('SKILL.md Examples cover happy path, focus, --interactive, and scope-fail', () => {
  const content = readFileSync(SKILL, 'utf8');
  const examples = content.match(/## Examples[\s\S]*$/);
  assert.ok(examples, 'Examples section must exist');
  const section = examples[0];
  assert.match(section, /\/post-dev-recap\s*\n/, 'Example 1: bare /post-dev-recap invocation');
  assert.match(section, /\/post-dev-recap\s+"/, 'Example 2: /post-dev-recap with focus');
  assert.match(section, /--interactive/, 'Example 3: --interactive');
  assert.match(section, /scope/i, 'Example 4: scope-fail path');
});

// --- Catalog registration contract ---

test('/post-dev-recap is registered in docs/skill-catalog.yml', () => {
  // The CLAUDE.md command tables were removed in R3 — docs/skill-catalog.yml
  // is the single registration surface. This replaces the old cross-file row
  // contract, whose tolerate-all-absent branch would otherwise have gone
  // silently vacuous once the tables disappeared.
  const catalog = readFileSync(resolve(REPO, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(catalog, /^ {2}- command: \/post-dev-recap$/m, '/post-dev-recap must be registered in the skill catalog');
});
