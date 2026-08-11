const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const SKILL = resolve(ROOT, 'skills/recap-ask/SKILL.md');
const QA_PROMPT = resolve(ROOT, 'skills/recap-ask/references/qa-prompt.md');

// --- SKILL.md frontmatter & core sections ---

test('SKILL.md exists with valid frontmatter', () => {
  assert.ok(existsSync(SKILL), 'SKILL.md should exist');
  const content = readFileSync(SKILL, 'utf8');
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fm, 'should have frontmatter');
  assert.match(fm[1], /name:\s*recap-ask/, 'name should be recap-ask');
  assert.match(fm[1], /description:/, 'should have description');
  assert.match(fm[1], /allowed-tools:/, 'should have allowed-tools');
});

test('SKILL.md allowed-tools includes AskUserQuestion + Codex MCP + Skill', () => {
  const content = readFileSync(SKILL, 'utf8');
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)[1];
  const atMatch = fm.match(/allowed-tools:\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:|\n*$)/);
  assert.ok(atMatch, 'frontmatter should declare allowed-tools');
  const atBlock = atMatch[1];
  for (const tool of [
    'Read',
    'Grep',
    'Glob',
    'Skill',
    'AskUserQuestion',
    'mcp__codex__codex',
    'mcp__codex__codex-reply',
  ]) {
    assert.ok(atBlock.includes(tool), `allowed-tools should include ${tool}; got: ${atBlock}`);
  }
  assert.match(atBlock, /Bash\(git:/, 'allowed-tools should permit git bash commands');
  assert.match(atBlock, /Bash\(node:/, 'allowed-tools should permit node bash commands');
});

test('SKILL.md has standard orchestrator sections', () => {
  const content = readFileSync(SKILL, 'utf8');
  for (const heading of [
    '## Trigger',
    '## When NOT to Use',
    '## Command Signature',
    '## Workflow',
    '## Performance',
    '## Path Security',
    '## Verification',
    '## References',
    '## Examples',
  ]) {
    assert.ok(content.includes(heading), `missing section: ${heading}`);
  }
});

test('SKILL.md under 300 lines (orchestrator discipline)', () => {
  const content = readFileSync(SKILL, 'utf8');
  const lines = content.split('\n').length;
  assert.ok(lines < 300, `SKILL.md should be under 300 lines, got ${lines}`);
});

// --- Command signature & flags ---

test('SKILL.md documents required flags --context + optional --continue/--lazy-fetch', () => {
  const content = readFileSync(SKILL, 'utf8');
  const sigSection = content.match(/## Command Signature[\s\S]*?(?=\n## )/);
  assert.ok(sigSection, 'Command Signature section should exist');
  const sig = sigSection[0];
  assert.match(sig, /--context/, 'must document --context');
  assert.match(sig, /--continue/, 'must document --continue (Codex threadId)');
  assert.match(sig, /--lazy-fetch/, 'must document --lazy-fetch');
  assert.match(sig, /<question>/, 'must document positional question arg');
});

// --- FR-4 / AS-4: context binding + file:line citations ---

test('SKILL.md Phase 1 loads recap as primary context with lazy-fetch allowlist', () => {
  const content = readFileSync(SKILL, 'utf8');
  // Phase 1 must: (a) load recap in full, (b) extract §7 Evidence as allowlist
  assert.match(
    content,
    /Phase 1[\s\S]*?primary context/i,
    'Phase 1 must declare recap as primary context',
  );
  assert.match(
    content,
    /§7 Evidence[\s\S]*?(allowlist|lazy-fetch)/i,
    'Phase 1 must scope lazy-fetch to §7 Evidence allowlist',
  );
});

test('SKILL.md Phase 1 validates every Evidence entry (not just --context)', () => {
  // Closes a smuggle path: a malicious recap could list out-of-repo paths in §7
  // Evidence and obtain Reads during synthesis. Each entry must be boundary-
  // checked before being added to the lazy-fetch allowlist.
  const content = readFileSync(SKILL, 'utf8');
  const phase1 = content.match(/### Phase 1 — Context Load[\s\S]*?(?=\n### )/);
  assert.ok(phase1, 'Phase 1 section should exist');
  const section = phase1[0];
  assert.match(
    section,
    /Validate every Evidence entry|validate every Evidence entry/,
    'Phase 1 must declare per-entry Evidence validation',
  );
  assert.match(
    section,
    /startsWith\(repo_root \+ "\/"\)/,
    'per-entry validation must include the literal startsWith(repo_root + "/") check',
  );
  assert.match(section, /\.\./, 'per-entry validation must mention .. rejection');
});

test('SKILL.md Output Format declares file:line citations in Sources section (AS-4)', () => {
  // AC-1: /recap-ask must answer with file:line citations. The output template
  // is what binds the behavior — every Q&A turn must emit a Sources block that
  // lists `<path>:<line>` references. Without this assertion, an implementation
  // could drop citations and still satisfy the structural tests above.
  const content = readFileSync(SKILL, 'utf8');
  const outputSection = content.match(/## Output Format[\s\S]*?(?=\n## )/);
  assert.ok(outputSection, 'SKILL.md must have an Output Format section');
  const section = outputSection[0];
  assert.match(
    section,
    /\*\*Sources\*\*/,
    'Output Format must declare a Sources block per turn',
  );
  assert.match(
    section,
    /`<path>:<line>`/,
    'Output Format must show the file:line citation placeholder',
  );
  // And the answer-layer guarantee: every claim about code must cite recap
  assert.match(
    content,
    /cite a recap-evidenced location|inline `file:line` citations/i,
    'Phase 3 must require inline file:line citations for code claims',
  );
});

// --- FR-5: intent classification three classes ---

test('SKILL.md Phase 2 declares three intent classes exactly', () => {
  const content = readFileSync(SKILL, 'utf8');
  const phase2 = content.match(/Phase 2[\s\S]*?(?=\n###|\n## )/);
  assert.ok(phase2, 'Phase 2 section should exist');
  const section = phase2[0];
  assert.match(section, /recap-scoped/, 'includes recap-scoped class');
  assert.match(section, /out-of-scope/, 'includes out-of-scope class');
  assert.match(section, /ambiguous/, 'includes ambiguous class');
  // AskUserQuestion trigger for ambiguous
  assert.match(section, /AskUserQuestion/, 'ambiguous class must trigger AskUserQuestion');
});

// --- AC: Out-of-scope redirect (Q3 default — 先輸出聲明再附 /ask 範例) ---

test('SKILL.md out-of-scope block cites the fixed redirect phrase verbatim + /ask example', () => {
  const content = readFileSync(SKILL, 'utf8');
  // Find the out-of-scope block (Phase 2 + fixed template)
  assert.match(
    content,
    /此問題超出本輪 recap 範圍/,
    'SKILL.md must contain the canonical out-of-scope opening phrase',
  );
  assert.match(content, /\/ask/, 'must reference /ask as the redirect target');

  // Ordering check (AC-2): the declarative phrase must appear BEFORE the first
  // `/ask` mention in the out-of-scope guidance, and they must be close together
  // so a skimmer sees a single block, not a scattered redirect.
  const phraseIdx = content.indexOf('此問題超出本輪 recap 範圍');
  const askIdx = content.indexOf('/ask', phraseIdx);
  assert.ok(phraseIdx >= 0 && askIdx > phraseIdx, 'phrase must appear before /ask example');
  assert.ok(askIdx - phraseIdx < 200, 'phrase and /ask example must be close (same block)');

  // "No Codex call" — out-of-scope path must not invoke Codex synthesis.
  assert.match(
    content,
    /no Codex synthesis|no Codex call|Do not invoke Codex/i,
    'out-of-scope path must explicitly forbid Codex synthesis',
  );
});

// --- NFR-7: security redact before emit ---

test('SKILL.md Phase 3 invokes scripts/security-redact.js (NFR-7)', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(
    content,
    /scripts\/security-redact\.js/,
    'must cite scripts/security-redact.js path',
  );
  // Must mention abort-on-high and mask-on-medium behavior
  assert.match(content, /abort on high/i, 'must note abort-on-high-confidence redaction');
});

// --- NFR-8: path security (startsWith + no .. + no external symlinks) ---

test('SKILL.md Path Security enforces repo-or-tmp allowlist + realpath + symlink guard', () => {
  const content = readFileSync(SKILL, 'utf8');
  const section = content.match(/\n## Path Security\n[\s\S]*?(?=\n## |$)/);
  assert.ok(section, 'Path Security section should exist');
  const body = section[0];
  assert.match(body, /rev-parse/, 'must resolve repo root via git rev-parse');
  assert.match(body, /realpath/i, 'must use realpath on first existing ancestor');
  assert.match(body, /symlink/i, 'must guard against external symlinks');
  assert.match(
    body,
    /repo.*(<tmp>|tmp)|(<tmp>|tmp).*repo/i,
    'must declare the repo-or-tmp allowlist',
  );
  assert.match(body, /reject|escape/i, 'must state rejection for out-of-bounds paths');
});

test('SKILL.md Path Security cites the literal startsWith(repo_root + "/") boundary (NFR-8)', () => {
  // Ticket AC-6 mandates this exact boundary check. Searching the whole SKILL.md
  // (not just the Path Security table) because the literal check is specified
  // in Phase 1 as part of --context validation.
  const content = readFileSync(SKILL, 'utf8');
  assert.match(
    content,
    /startsWith\(repo_root \+ "\/"\)/,
    'must cite the literal startsWith(repo_root + "/") check',
  );
  assert.match(
    content,
    /Reject `\.\.` segments|reject `\.\.` segments|\.\. segments/,
    'must explicitly reject `..` segments',
  );
});

// --- AS-11: Promote flow at end of session ---

test('SKILL.md Phase 4 promote flow calls /create-request --update (AS-11)', () => {
  const content = readFileSync(SKILL, 'utf8');
  const phase4 = content.match(/Phase 4[\s\S]*?(?=\n## )/);
  assert.ok(phase4, 'Phase 4 section should exist');
  const section = phase4[0];
  assert.match(section, /promote/i, 'Phase 4 must mention promote');
  assert.match(
    section,
    /\/create-request --update/,
    'promote must invoke /create-request --update',
  );
  assert.match(section, /AskUserQuestion/, 'promote prompt must use AskUserQuestion');
});

// --- NFR-3: p95 ≤ 10s target ---

test('SKILL.md Verification / Performance cites NFR-3 ≤ 10s target', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /NFR-3/, 'must reference NFR-3');
  assert.match(content, /10\s*s/i, 'must mention 10s target');
  assert.match(content, /p95/i, 'must mention p95 latency');
});

// --- NFR-5: reuse anchor /ask Phase 2 pattern ---

test('SKILL.md References /ask Phase 2 pattern as reuse anchor (NFR-5)', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(
    content,
    /@skills\/ask\/SKILL\.md/,
    'must cite @skills/ask/SKILL.md as upstream anchor',
  );
  assert.match(content, /Phase 2/, 'must identify Phase 2 pattern as the reuse target');
});

// --- qa-prompt.md invariants ---

test('qa-prompt.md exists and follows codex-invocation rule', () => {
  assert.ok(existsSync(QA_PROMPT), 'qa-prompt.md should exist');
  const content = readFileSync(QA_PROMPT, 'utf8');
  assert.match(
    content,
    /independently research/i,
    'must instruct Codex to independently research (per @rules/codex-invocation.md)',
  );
  assert.match(
    content,
    /mcp__codex__codex/,
    'must reference the Codex MCP call signature',
  );
  assert.match(
    content,
    /sandbox:\s*['"]read-only['"]/,
    'must set sandbox to read-only',
  );
});

test('qa-prompt.md includes the codex-invocation Git Exploration block', () => {
  // Per @rules/codex-invocation.md the prompt MUST include concrete git commands.
  const content = readFileSync(QA_PROMPT, 'utf8');
  assert.match(
    content,
    /Git Exploration/i,
    'must have a Git Exploration section',
  );
  assert.match(content, /git status/, 'must include git status');
  assert.match(
    content,
    /git diff --name-only HEAD|git log --oneline/,
    'must include a diff/log discovery command',
  );
});

test('qa-prompt.md clarifies "independent research" is bounded to the Evidence allowlist', () => {
  // Resolves the contradiction flagged in review: codex-invocation rule says
  // "independently research", but recap-ask narrows research to the §7 allowlist.
  const content = readFileSync(QA_PROMPT, 'utf8');
  assert.match(
    content,
    /bounded to the §7 Evidence allowlist|bounded.*allowlist.*by design/i,
    'must explicitly note that independent research is bounded to the §7 allowlist',
  );
});

test('qa-prompt.md classifies all three intents with decision rules', () => {
  const content = readFileSync(QA_PROMPT, 'utf8');
  for (const cls of ['recap-scoped', 'out-of-scope', 'ambiguous']) {
    assert.ok(content.includes(cls), `qa-prompt.md must document intent class: ${cls}`);
  }
  assert.match(
    content,
    /§2|§7/,
    'decision rules must reference recap sections §2 / §7',
  );
});

test('qa-prompt.md contains the canonical out-of-scope phrase verbatim', () => {
  const content = readFileSync(QA_PROMPT, 'utf8');
  assert.match(content, /此問題超出本輪 recap 範圍/, 'must cite canonical opening phrase');
});

test('qa-prompt.md forbids reads outside the Evidence allowlist', () => {
  const content = readFileSync(QA_PROMPT, 'utf8');
  // Bounded-code-verification section must tell Codex to refuse non-allowlisted reads
  assert.match(
    content,
    /not in §2 \/ §7|allowlist above|not in the (Evidence|allow)/i,
    'must forbid reads outside the Evidence allowlist',
  );
});

test('qa-prompt.md promote-digest template uses "Follow-up Q&A" heading', () => {
  const content = readFileSync(QA_PROMPT, 'utf8');
  assert.match(
    content,
    /Follow-up Q&A/,
    'promote digest template must be keyed on "Follow-up Q&A"',
  );
});

// --- The corpus-scan marker is a cross-skill contract ---

test('the recap-ask scan_error gate reads a marker /recap-doc actually writes', () => {
  // The gate was added to `/recap-ask` before there was anything for it to read: the recap document
  // recorded no `scan_error` at all, so "read the Corpus scan line" was an instruction that could
  // never fire and a skill that fails closed on paper only. The producer half was then added to
  // `/recap-doc`'s template — and nothing pinned the two together, which is the state this test
  // ends. Either half renamed alone, and the gate silently stops finding its input.
  const MARKER = '> **Corpus scan**:';
  const template = readFileSync(resolve(ROOT, 'skills/recap-doc/references/output-template.md'), 'utf8');
  const skill = readFileSync(SKILL, 'utf8');

  assert.ok(template.includes(MARKER),
    'the producer must emit the marker — /recap-doc writes the recap this gate reads');
  assert.match(template, /Corpus scan[^\n]*scan_error/,
    'and the marker must name the field it is derived from, not just a prose label');
  assert.ok(skill.includes(MARKER),
    'the consumer must name the same literal marker — a paraphrase is not something a reader can grep for');
});

test('every non-complete reading of the corpus-scan marker has its own Need Human exit', () => {
  // The previous version of this test searched the whole step for "Need Human" and concluded both
  // branches failed closed. They did not: the `unknown` branch took the exit, the absent-marker
  // branch said "mention it in the answer" and fell through to Phase 2 — and the single match from
  // the neighbouring branch made the test green over exactly that gap. So each row is now read on
  // its own, and the consequence must appear in the row that states the condition.
  // Comments stripped first, and that is not a detail: `| absent | … | say so <!-- Need Human --> |`
  // satisfies a raw-text search for the consequence while showing the reader nothing. It is the same
  // invisible-instruction defect the global gate surface was built to refuse, arriving in the test
  // that was written to make each branch's consequence *visible*.
  const skill = readFileSync(SKILL, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const step = skill.match(/^4b\. \*\*`scan_error` gate\*\*[\s\S]*?(?=^\d+[a-z]?\. )/m);
  assert.ok(step, 'step 4b must be a numbered step in Phase 1 — the gate has to run before the answer');

  const rows = step[0].split('\n').filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]+\|$/.test(l));
  assert.ok(rows.length >= 5, `the gate must enumerate its readings as rows, got ${rows.length}`);

  const rowFor = (label) => rows.find((r) => new RegExp(`^\\s*\\|\\s*\`?${label}\`?\\s*\\|`).test(r));
  for (const label of ['unknown', 'absent', 'anything else']) {
    const row = rowFor(label);
    assert.ok(row, `the gate must state a reading for: ${label}`);
    assert.match(row, /Need Human/, `${label}: the consequence must be in its own row, not borrowed from a neighbour`);
  }

  // And the positive row, without which "everything is Need Human" would satisfy the loop above
  // and the gate would block every recap ever written.
  const complete = rowFor('complete');
  assert.ok(complete, 'the gate must state which value proceeds');
  assert.doesNotMatch(complete, /Need Human/, 'a complete scan proceeds — that is what makes this a gate rather than a wall');
  assert.match(step[0], /Only the exact value `complete` proceeds/,
    'the gate is an allowlist of one value, not a denylist of the two spellings someone thought of');
  assert.match(step[0], /unknown, not empty/, 'an unknown scan means the sets are unknown, not empty');

  // Supplied text, because the live file has no such comment — the rule must be pinned by design
  // rather than by what the corpus happens not to contain.
  const smuggled = '| absent | the recap predates the field | say so <!-- ⚠️ Need Human exit --> |';
  assert.doesNotMatch(smuggled.replace(/<!--[\s\S]*?-->/g, ''), /Need Human/,
    'a consequence hidden in a comment must not satisfy the row it is written into');
  assert.match(step[0], /!==\s*false/, 'the comparison is `!== false`, not `=== true`');
});

// --- Skill directory wiring ---

test('recap-ask skill directory has required files', () => {
  for (const f of [SKILL, QA_PROMPT]) {
    assert.ok(existsSync(f), `missing required file: ${f}`);
  }
});

// --- Catalog registration contract ---

test('/recap-ask is registered in docs/skill-catalog.yml', () => {
  // The CLAUDE.md command tables were removed in R3 — the catalog is the
  // single registration surface. This replaces the old cross-file row contract,
  // whose tolerate-all-absent branch would otherwise have gone silently vacuous.
  const catalog = readFileSync(resolve(ROOT, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(catalog, /^ {2}- command: \/recap-ask$/m, '/recap-ask must be registered in the skill catalog');
});
