const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const SKILL = resolve(ROOT, 'skills/recap-doc/SKILL.md');
const OUTPUT_TPL = resolve(ROOT, 'skills/recap-doc/references/output-template.md');
const SOURCE_GUIDE = resolve(ROOT, 'skills/recap-doc/references/source-guide.md');
const PROMPT_TPL = resolve(ROOT, 'skills/recap-doc/references/prompt-template.md');
const TAXONOMY = resolve(ROOT, 'scripts/config/doc-taxonomy.json');

// --- SKILL.md frontmatter & core sections ---

test('SKILL.md exists with valid frontmatter', () => {
  assert.ok(existsSync(SKILL), 'SKILL.md should exist');
  const content = readFileSync(SKILL, 'utf8');
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fm, 'should have frontmatter');
  assert.match(fm[1], /name:\s*recap-doc/, 'name should be recap-doc');
  assert.match(fm[1], /description:/, 'should have description');
  assert.match(fm[1], /allowed-tools:/, 'should have allowed-tools');
});

test('SKILL.md allowed-tools includes core tools plus Skill + Codex MCP', () => {
  const content = readFileSync(SKILL, 'utf8');
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)[1];
  // Tolerate both YAML styles: inline `allowed-tools: Read, Grep` and list
  // form `allowed-tools:\n  - Read\n  - Grep`. Grab everything from the key
  // until the next top-level field or end of frontmatter.
  const atMatch = fm.match(/allowed-tools:\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:|\n*$)/);
  assert.ok(atMatch, 'frontmatter should declare allowed-tools');
  const atBlock = atMatch[1];
  for (const tool of ['Read', 'Grep', 'Glob', 'Write', 'Skill', 'mcp__codex__codex']) {
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
    '## Depth Levels',
    '## Save Behavior',
    '## Path Security',
    '## Performance',
    '## Output Structure',
    '## Verification',
    '## References',
    '## Examples',
  ]) {
    assert.ok(content.includes(heading), `SKILL.md should contain heading: ${heading}`);
  }
});

test('SKILL.md disambiguates against neighboring skills', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /\/recap-ask/, 'should route Q&A to /recap-ask');
  assert.match(content, /\/tech-brief/, 'should mention /tech-brief alternative');
  assert.match(content, /\/codex-explain/, 'should mention /codex-explain alternative');
});

test('SKILL.md workflow covers all five phases', () => {
  const content = readFileSync(SKILL, 'utf8');
  // Phases 1-5 must each be referenced explicitly (by name, not just number)
  assert.match(content, /Phase 1[\s\S]*Scope Load/i, 'Phase 1 Scope Load');
  assert.match(content, /Phase 2[\s\S]*Evidence Collection/i, 'Phase 2 Evidence Collection');
  assert.match(content, /Phase 3[\s\S]*Spec Cross-reference/i, 'Phase 3 Spec Cross-reference');
  assert.match(content, /Phase 4[\s\S]*Synthesis/i, 'Phase 4 AI Synthesis');
  assert.match(content, /Phase 5[\s\S]*Redaction/i, 'Phase 5 Redaction');
});

test('SKILL.md Phase 4 calls /codex-explain (NFR-5 reuse)', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /\/codex-explain/, 'Phase 4 must delegate to /codex-explain skill');
});

test('SKILL.md Phase 5 invokes security-redact.js (NFR-7)', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /security-redact\.js/, 'Phase 5 must invoke security-redact.js');
});

test('SKILL.md documents ≤ 30s performance target (NFR-2)', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /## Performance/, 'should have Performance section');
  assert.match(content, /30\s*s/i, 'should mention 30s target');
  assert.match(content, /NFR-2/, 'should reference NFR-2');
});

test('SKILL.md path security enforces repo-or-tmp boundary and rejects escapes', () => {
  // Policy: default writes to <tmp>; --output is allowed only when the
  // canonical (realpath-resolved) target is inside the repo root or <tmp>.
  // Paths that escape both roots must be rejected.
  const content = readFileSync(SKILL, 'utf8');
  // Require preceding newline so inline backtick references to `## Path Security`
  // in other sections don't pre-empt the real heading. No /m flag: end-of-string
  // `$` must be the whole file, not end-of-line.
  const section = content.match(/\n## Path Security\n[\s\S]*?(?=\n## |$)/);
  assert.ok(section, 'should have Path Security section');
  const body = section[0];
  assert.match(body, /rev-parse/, 'should resolve repo root via git rev-parse');
  assert.match(body, /realpath/i, 'should use realpath on first existing ancestor');
  assert.match(body, /symlink/i, 'should guard against external symlinks');
  assert.match(body, /repo.*(<tmp>|tmp)|(<tmp>|tmp).*repo/i, 'must declare the repo-or-tmp allowlist');
  assert.match(body, /reject|outside|escape/i, 'must state rejection for out-of-bounds paths');
});

test('SKILL.md under 300 lines (orchestrator discipline)', () => {
  const content = readFileSync(SKILL, 'utf8');
  const lines = content.split('\n').length;
  assert.ok(lines < 300, `SKILL.md should be under 300 lines, got ${lines}`);
});

// --- Depth matrix & top-N (brief=5, normal=10, deep=15) ---

test('SKILL.md declares depth levels with correct top-N values', () => {
  const content = readFileSync(SKILL, 'utf8');
  // Constrain all depth-matrix assertions to the Depth Levels section so
  // contradictory values elsewhere in SKILL.md cannot mask a regression.
  const depthSection = content.match(/## Depth Levels[\s\S]*?(?=\n## |$)/);
  assert.ok(depthSection, 'Depth Levels section should exist');
  const section = depthSection[0];
  // Top-N values must be bound to their depth level inside the Depth Levels
  // section. The table shape `| <depth> | <top-N> | ...` is the contract —
  // check it directly rather than matching loose tokens that could appear
  // anywhere in SKILL.md.
  assert.match(section, /\|\s*brief\s*\|\s*5\s*\|/, 'brief row declares top-N = 5');
  assert.match(section, /\|\s*normal\s*\|\s*10\s*\|/, 'normal row declares top-N = 10');
  assert.match(section, /\|\s*deep\s*\|\s*15\s*\|/, 'deep row declares top-N = 15');
});

test('output-template.md depth matrix spans all sections', () => {
  assert.ok(existsSync(OUTPUT_TPL), 'output-template.md should exist');
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  assert.match(content, /## Depth Matrix/, 'should have Depth Matrix section');
  // Table header includes brief/normal/deep
  assert.match(content, /\|\s*brief\s*\|\s*normal\s*\|\s*deep\s*\|/i, 'depth matrix table headers');
  // Top-N values present
  assert.match(content, /top-5/, 'brief top-5');
  assert.match(content, /top-10/, 'normal top-10');
  assert.match(content, /top-15/, 'deep top-15');
});

// --- FR-9 Blind Spots: always-on heading + fallback ---

test('output-template.md has Blind Spots section always-on (FR-9 Must)', () => {
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  assert.match(content, /## 5\. Blind Spots/, 'should have §5 Blind Spots heading');
  assert.match(content, /ALWAYS present/i, 'should mark always-present');
  assert.match(content, /FR-9/, 'should reference FR-9');
});

test('output-template.md has fallback wording when no blind spots', () => {
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  assert.match(content, /本輪未偵測到明顯盲點/, 'must include fallback wording');
  // Fallback wording should include reasoning reference, not a bare sentence
  assert.match(content, /推論依據/, 'fallback must provide reasoning');
});

test('output-template.md depth matrix requires §5 at all depths', () => {
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  // Match a row like "| §5 Blind Spots | top-3... | full list... | full list... |"
  const row = content.match(/\|\s*§5 Blind Spots[^\n]+\|/);
  assert.ok(row, '§5 row should exist in depth matrix');
  // Preserve empties so we detect truncated rows — filter(Boolean) would
  // let a broken "| §5 | | | |" row pass this test vacuously.
  const cells = row[0].split('|').map((c) => c.trim());
  // Expected layout: ['', '§5 ...', brief, normal, deep, '']
  assert.ok(cells.length >= 6, `§5 row should have 4 cells + 2 edges, got ${cells.length}: ${row[0]}`);
  const depthCells = cells.slice(2, 5);
  assert.equal(depthCells.length, 3, '§5 row must have exactly brief/normal/deep cells');
  for (const c of depthCells) {
    assert.ok(c.length > 0, `§5 cell should be non-empty, got: "${c}"`);
    assert.ok(!/^omit/i.test(c), `§5 cell must not start with 'omit': "${c}"`);
  }
});

test('output-template.md lists blind-spot heuristics (FR-9)', () => {
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  assert.match(content, /## Blind Spots Heuristics/, 'should have heuristics section');
  for (const heuristic of [
    /Test without source/,
    /Source without test/,
    /Config change/,
    /Secret near boundary/,
    /Large deletion/,
    /Rename without update/,
    /Missing request ticket/,
  ]) {
    assert.match(content, heuristic, `heuristic present: ${heuristic}`);
  }
});

// --- FR-11 Anticipated Questions: brief omits, normal/deep ≥ 3 ---

test('output-template.md depth matrix omits §6 at brief (FR-11)', () => {
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  const row = content.match(/\|\s*§6 Anticipated Questions[^\n]+\|/);
  assert.ok(row, '§6 row should exist in depth matrix');
  const cells = row[0].split('|').map((c) => c.trim());
  // cells: ['', '§6 Anticipated Questions', briefCell, normalCell, deepCell, '']
  const [briefCell, normalCell, deepCell] = cells.slice(2, 5);
  assert.match(briefCell, /omit/i, `brief cell should say 'omit', got: "${briefCell}"`);
  assert.match(normalCell, /≥\s*3|3\+|at least 3/i, `normal cell should require ≥3, got: "${normalCell}"`);
  assert.match(deepCell, /≥\s*3|3\+|at least 3/i, `deep cell should require ≥3, got: "${deepCell}"`);
});

test('output-template.md §6 template directs follow-up to /recap-ask (FR-11 handoff)', () => {
  // §6 must route deeper questions to /recap-ask per FR-11 handoff clause.
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  const section = content.match(/## 6\. Anticipated Questions[\s\S]*?(?=\n## |$)/);
  assert.ok(section, '§6 Anticipated Questions section should exist in template');
  assert.match(section[0], /\/recap-ask/, '§6 template must cite /recap-ask for follow-up');
});

test('output-template.md §5 describes both heuristic bullets and fallback (mutual exclusion)', () => {
  // §5 must cover both paths: some heuristics triggered → bullets; zero → fallback block.
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  const section = content.match(/## 5\. Blind Spots[\s\S]*?(?=\n## |$)/);
  assert.ok(section, '§5 Blind Spots section should exist in template');
  assert.match(section[0], /Heuristic name|\{Heuristic name\}/, '§5 must show heuristic bullet template');
  assert.match(section[0], /Fallback/i, '§5 must name the fallback case');
  assert.match(section[0], /when no items qualify/i, '§5 fallback must state the trigger condition');
});

// --- §2 Changed Files must carry file:line references ---

test('output-template.md Changed Files template requires file:line', () => {
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  // Invariant section should state this explicitly
  assert.match(content, /## Invariants/, 'should have Invariants section');
  assert.match(content, /file:line/, 'should mandate file:line references');
  // Template row example includes {path}:{line}
  assert.match(content, /\{path\}:\{line\}/, 'template row shows file:line placeholder');
});

// --- §4 Drift table conditional on has_tech_spec ---

test('output-template.md Drift section is conditional on has_tech_spec', () => {
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  assert.match(content, /## 4\. Spec vs Implementation Drift/, 'should have §4 heading');
  assert.match(content, /has_tech_spec/, 'should gate on has_tech_spec field');
});

test('prompt-template.md instructs drift synthesis only when has_tech_spec', () => {
  assert.ok(existsSync(PROMPT_TPL), 'prompt-template.md should exist');
  const content = readFileSync(PROMPT_TPL, 'utf8');
  assert.match(content, /§4 Spec vs Implementation Drift/, 'mentions §4 Drift');
  assert.match(content, /has_tech_spec/, 'gates drift on has_tech_spec');
});

// --- source-guide.md reuse pattern ---

test('source-guide.md has 3 stages and contrasts tech-brief scope', () => {
  assert.ok(existsSync(SOURCE_GUIDE), 'source-guide.md should exist');
  const content = readFileSync(SOURCE_GUIDE, 'utf8');
  assert.match(content, /## Stage 1/, 'Stage 1 present');
  assert.match(content, /## Stage 2/, 'Stage 2 present');
  assert.match(content, /## Stage 3/, 'Stage 3 present');
  assert.match(content, /tech-brief/, 'references tech-brief reuse pattern');
  assert.match(content, /Missing Source/, 'handles missing source');
});

test('source-guide.md specifies top-N selection by depth', () => {
  const content = readFileSync(SOURCE_GUIDE, 'utf8');
  assert.match(content, /brief/, 'mentions brief');
  assert.match(content, /normal/, 'mentions normal');
  assert.match(content, /deep/, 'mentions deep');
  assert.match(content, /lines_changed/, 'sorts by lines_changed');
});

// --- prompt-template.md obeys codex-invocation rule ---

test('prompt-template.md includes independently-research block for Codex', () => {
  const content = readFileSync(PROMPT_TPL, 'utf8');
  assert.match(content, /independently research/i, 'must include independent-research mandate');
  assert.match(content, /codex-invocation\.md/, 'should cite codex-invocation rule');
});

test('prompt-template.md lists prohibited patterns (no feeding conclusions)', () => {
  const content = readFileSync(PROMPT_TPL, 'utf8');
  assert.match(content, /## Prohibited Patterns/, 'should enumerate prohibited patterns');
  assert.match(content, /Feeds conclusion|feeding conclusion/i, 'prohibits feeding conclusions');
  assert.match(content, /Confirmation prompt/i, 'prohibits confirmation prompts');
});

test('prompt-template.md enforces Blind Spots mandate and fallback wording', () => {
  const content = readFileSync(PROMPT_TPL, 'utf8');
  assert.match(content, /FR-9/, 'references FR-9');
  assert.match(content, /本輪未偵測到明顯盲點/, 'cites fallback wording verbatim');
});

test('prompt-template.md omits §6 at brief depth', () => {
  const content = readFileSync(PROMPT_TPL, 'utf8');
  assert.match(content, /brief/, 'mentions brief');
  assert.match(content, /OMIT if .*brief|brief.*omit/i, 'instructs to omit §6 at brief');
});

// --- Save behavior & taxonomy integration ---

test('SKILL.md save behavior produces briefing- prefix', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /## Save Behavior/, 'should have Save Behavior section');
  assert.match(content, /briefing-recap-/, 'output filename uses briefing- prefix');
});

// Helper — parse the Default row cells from a Save Behavior section.
function extractDefaultRowCells(sectionText) {
  const row = sectionText.match(/\|\s*Default[^\n]+\|/);
  if (!row) return null;
  const cells = row[0].split('|').map((c) => c.trim());
  // Expected: ['', 'Default (no `--output`)', '<path cell>', '']
  return cells.length >= 4 ? cells.slice(1, 3) : null;
}

test('SKILL.md defaults to OS tmp dir so recaps never pollute the project tree', () => {
  // Contract: without --output, the recap is ephemeral (tmp), not written under
  // docs/. Callers that want a committed recap must opt in via --output.
  // Assert against the Default row's actual path cell — not just section-level
  // tokens — so a contradictory row can't slip past.
  const content = readFileSync(SKILL, 'utf8');
  const save = content.match(/## Save Behavior[\s\S]*?(?=\n## |$)/);
  assert.ok(save, 'Save Behavior section should exist');
  const section = save[0];

  const cells = extractDefaultRowCells(section);
  assert.ok(cells, 'Default row should exist with label + path cells in save-behavior table');
  const [labelCell, pathCell] = cells;
  assert.match(labelCell, /Default.*no `--output`/, `label cell mis-shaped: "${labelCell}"`);

  // Strict path contract: must cite <tmp>, the sd0x-dev-flow-recap namespace,
  // and the briefing-recap-<date>.md filename; must NOT route under docs/.
  assert.match(
    pathCell,
    /<tmp>\/sd0x-dev-flow-recap\/briefing-recap-<YYYY-MM-DD>\.md/,
    `default path cell must match canonical <tmp>/sd0x-dev-flow-recap/briefing-recap-<YYYY-MM-DD>.md, got: "${pathCell}"`,
  );
  assert.ok(
    !/docs\//.test(pathCell),
    `default path cell must not reference docs/: "${pathCell}"`,
  );

  // Section narrative must also spell out the tmp-resolution chain in order so
  // implementers don't drift to a different fallback sequence.
  const tmpResolveOrder = section.match(
    /\$TMPDIR[\s\S]*?os\.tmpdir\(\)[\s\S]*?\/tmp/,
  );
  assert.ok(
    tmpResolveOrder,
    'Save Behavior must document resolution order: $TMPDIR -> os.tmpdir() -> /tmp',
  );
});

test('output-template.md save behavior mirrors SKILL.md tmp-first default', () => {
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  const save = content.match(/## Save Behavior[\s\S]*?(?=\n## |$)/);
  assert.ok(save, 'output-template Save Behavior section should exist');
  const section = save[0];

  // Same strict Default row check as SKILL.md so the two files can't drift.
  const cells = extractDefaultRowCells(section);
  assert.ok(cells, 'Default row should exist in output-template save-behavior table');
  const [labelCell, pathCell] = cells;
  assert.match(labelCell, /Default.*no `--output`/, `label cell mis-shaped: "${labelCell}"`);
  assert.match(
    pathCell,
    /<tmp>\/sd0x-dev-flow-recap\/briefing-recap-<YYYY-MM-DD>\.md/,
    `default path cell mis-shaped: "${pathCell}"`,
  );
  assert.ok(!/docs\//.test(pathCell), `default path cell must not reference docs/: "${pathCell}"`);

  // Must flag ephemeral + cite the same resolution chain to keep parity with
  // the authoritative rule in SKILL.md.
  assert.match(section, /ephemeral/i, 'template must flag default as ephemeral');
  assert.match(
    section,
    /\$TMPDIR[\s\S]*?os\.tmpdir\(\)[\s\S]*?\/tmp/,
    'template must repeat resolution order: $TMPDIR -> os.tmpdir() -> /tmp',
  );
});

test('doc-taxonomy.json has briefing ancillary pattern (classifier sanity)', () => {
  assert.ok(existsSync(TAXONOMY), 'doc-taxonomy.json should exist');
  const taxonomy = JSON.parse(readFileSync(TAXONOMY, 'utf8'));
  const types = taxonomy.types || taxonomy.namespaces?.ancillary?.types || [];
  const briefing = types.find((t) => t.id === 'briefing');
  assert.ok(briefing, 'briefing type must be registered');
  assert.equal(briefing.namespace, 'ancillary', 'briefing is ancillary');
  assert.match(briefing.semantic_pattern, /^\^briefing-/, 'pattern anchors on briefing-');
});

// --- ScopeReport contract alignment ---

test('output-template.md references ScopeReport v1 fields', () => {
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  assert.match(content, /ScopeReport/, 'mentions ScopeReport');
  for (const field of ['source', 'base_ref', 'confidence', 'detected_at', 'files\\[\\]', 'feature_context']) {
    assert.match(content, new RegExp(field), `maps field: ${field}`);
  }
});

test('SKILL.md validates ScopeReport v1 in Phase 1', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /version\s*===?\s*1/, 'Phase 1 checks version === 1');
  assert.match(content, /detect-scope\.js/, 'references T1 producer');
});

// --- CLAUDE.md registration (T5 will wire up fully, but SKILL must be discoverable) ---

test('recap-doc skill directory has required files', () => {
  for (const path of [SKILL, OUTPUT_TPL, SOURCE_GUIDE, PROMPT_TPL]) {
    assert.ok(existsSync(path), `file should exist: ${path}`);
  }
});

test('/recap-doc is registered in docs/skill-catalog.yml with a discoverable description', () => {
  // The CLAUDE.md command tables were removed in R3 — the catalog is the
  // single registration surface, so there is no cross-file row to keep in sync.
  const catalog = readFileSync(resolve(ROOT, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(catalog, /^ {2}- command: \/recap-doc$/m, '/recap-doc must be registered in the skill catalog');
  // Discovery now rides on the SKILL frontmatter description.
  const skill = readFileSync(SKILL, 'utf8');
  const fm = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, 'SKILL.md must have frontmatter');
  assert.match(fm[1], /^description:\s*\S+/m, 'SKILL.md frontmatter must carry a non-empty description');
});
