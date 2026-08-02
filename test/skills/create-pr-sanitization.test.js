const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/create-pr/SKILL.md');
const guardPath = resolve(root, 'scripts/commit-msg-guard.sh');
const claudeMdPath = resolve(root, 'CLAUDE.md');

const claudeContent = readFileSync(claudeMdPath, 'utf8');
const skillContent = readFileSync(skillPath, 'utf8');
const guardContent = readFileSync(guardPath, 'utf8');

// --- Canonical pattern extraction from commit-msg-guard.sh ---

function extractCanonicalPatterns(content) {
  const match = content.match(/PATTERNS=\(([\s\S]*?)\n\)/);
  if (!match) return [];
  const patterns = [];
  const regex = /'([^']+)'/g;
  let m;
  while ((m = regex.exec(match[1])) !== null) {
    patterns.push(m[1]);
  }
  return patterns;
}

function extractSkillPatternTable(content) {
  const tableStart = content.indexOf('**Forbidden patterns**');
  if (tableStart === -1) return '';
  const nextSection = content.indexOf('###', tableStart + 1);
  return content.slice(tableStart, nextSection !== -1 ? nextSection : undefined);
}

/** Extract a markdown section by heading (### or ##), up to the next same-or-higher-level heading */
function extractSection(content, heading) {
  const idx = content.indexOf(heading);
  if (idx === -1) return null;
  const level = heading.match(/^#+/)[0].length;
  const afterHeading = content.slice(idx + heading.length);
  const nextHeadingRe = new RegExp(`^#{1,${level}} `, 'm');
  const nextMatch = afterHeading.search(nextHeadingRe);
  return nextMatch !== -1
    ? content.slice(idx, idx + heading.length + nextMatch)
    : content.slice(idx);
}

const canonicalPatterns = extractCanonicalPatterns(guardContent);

// --- Tests: Forbidden Pattern Table ---

test('create-pr SKILL.md contains Forbidden Pattern Table section', () => {
  assert.ok(
    skillContent.includes('Forbidden patterns'),
    'should have Forbidden patterns section after Generate Body Rules'
  );
});

test('create-pr SKILL.md references canonical source commit-msg-guard.sh', () => {
  assert.ok(
    skillContent.includes('commit-msg-guard.sh'),
    'should reference canonical source script'
  );
});

test('create-pr SKILL.md contains all 3 canonical pattern categories', () => {
  assert.ok(
    skillContent.includes('Co-Authored-By AI'),
    'should have Co-Authored-By AI pattern category'
  );
  assert.ok(
    skillContent.includes('Generated-by tag'),
    'should have Generated-by tag pattern category'
  );
  assert.ok(
    skillContent.includes('Emoji robot tag'),
    'should have Emoji robot tag pattern category'
  );
});

test('create-pr pattern table matches canonical patterns from commit-msg-guard.sh', () => {
  assert.equal(canonicalPatterns.length, 3, 'canonical source should have 3 patterns');
  const tableBlock = extractSkillPatternTable(skillContent);
  assert.ok(tableBlock.length > 0, 'should find Forbidden patterns table block');
  for (const pattern of canonicalPatterns) {
    const mdEscaped = pattern.replace(/\|/g, '\\|');
    assert.ok(
      tableBlock.includes(pattern) || tableBlock.includes(mdEscaped),
      'Forbidden patterns table should contain canonical pattern: ' + pattern
    );
  }
});

// --- Tests: Step 4b — Pre-output Sanitization ---

test('create-pr SKILL.md has Step 4b AI Content Sanitization', () => {
  assert.ok(
    skillContent.includes('### 4b. AI Content Sanitization'),
    'should have Step 4b section header'
  );
});

test('Step 4b specifies title regenerate/fail strategy (not strip)', () => {
  assert.ok(
    skillContent.includes('regenerate/fail'),
    'title strategy should be regenerate/fail'
  );
  assert.ok(
    skillContent.includes('HARD FAIL'),
    'should mention HARD FAIL for title that still matches after regeneration'
  );
});

test('Step 4b specifies body line-strip + log strategy', () => {
  assert.ok(
    skillContent.includes('[AI_STRIPPED]'),
    'body strategy should log removed lines with [AI_STRIPPED]'
  );
});

test('Step 4b covers --title override scan', () => {
  const section = extractSection(skillContent, '### 4b. AI Content Sanitization');
  assert.ok(section, 'should have Step 4b section');
  assert.ok(
    section.includes('--title') && section.includes('scan'),
    'Step 4b should mention --title override with scan requirement'
  );
});

// --- Tests: Step 7b — Post-creation Verify ---

test('create-pr SKILL.md has Step 7b Post-creation Verify', () => {
  assert.ok(
    skillContent.includes('### 7b. Post-creation Verify'),
    'should have Step 7b section header'
  );
});

test('Step 7b specifies execute-only scope', () => {
  const section = extractSection(skillContent, '### 7b. Post-creation Verify');
  assert.ok(section, 'should have Step 7b section');
  assert.ok(
    section.includes('execute-only') || section.includes('--execute mode'),
    'Step 7b should specify execute-only scope'
  );
});

test('Step 7b uses gh pr view for verification', () => {
  assert.ok(
    skillContent.includes('gh pr view'),
    'should use gh pr view to fetch published content'
  );
});

test('Step 7b has auto-remediate with single attempt guardrail', () => {
  assert.ok(
    skillContent.includes('auto-remediate') || skillContent.includes('Auto-remediate'),
    'should have auto-remediate mechanism'
  );
  assert.ok(
    skillContent.includes('Single remediation attempt'),
    'should have single-attempt guardrail'
  );
});

test('Step 7b uses safe escaping (single-quote rendering + --body-file)', () => {
  // The title escaping contract moved from `printf '%s' '<v>'` to direct
  // single-quote rendering: the printf form still placed the value inside a
  // "$( )" substitution, which does not neutralise a `$( )` in the value.
  assert.ok(
    skillContent.includes('#### Command Rendering'),
    'should define a single-quote rendering contract for titles and branches'
  );
  assert.ok(
    !skillContent.includes('$(printf'),
    'should not wrap dynamic values in a command substitution'
  );
  assert.ok(
    skillContent.includes('--body-file'),
    'should use --body-file for safe body escaping'
  );
});

// --- Tests: Step 5a Update Mode Integration ---

test('Step 5a references Step 4b sanitization', () => {
  const section = extractSection(skillContent, '### 5a. Update Mode');
  assert.ok(section, 'should have Step 5a section');
  assert.ok(
    section.includes('Step 4b'),
    'Step 5a should reference Step 4b sanitization pipeline'
  );
});

// --- Tests: Edge Cases ---

test('Edge Cases: --title override requires Step 4b scan', () => {
  const section = extractSection(skillContent, '## Edge Cases');
  assert.ok(section, 'should have Edge Cases section');
  assert.ok(
    section.includes('Step 4b') && section.includes('--title'),
    'Edge Cases should specify --title override runs Step 4b scan'
  );
});

// --- Tests: Verification Checklists ---

test('Verification checklists include Step 4b and 7b items', () => {
  const verifyIdx = skillContent.indexOf('## Verification');
  assert.ok(verifyIdx !== -1, 'should have Verification section');
  const verifySection = skillContent.slice(verifyIdx);
  assert.ok(
    verifySection.includes('Step 4b'),
    'Verification should reference Step 4b'
  );
  assert.ok(
    verifySection.includes('Step 7b'),
    'Verification should reference Step 7b'
  );
});

// --- Tests: CLAUDE.md Development Rules ---

test('CLAUDE.md Development Rules #3 covers PR title/body', () => {
  assert.ok(
    claudeContent.includes('PR title/body'),
    'Development Rules #3 should mention PR title/body'
  );
});

test('CLAUDE.md Development Rules #3 references canonical source', () => {
  assert.ok(
    claudeContent.includes('commit-msg-guard.sh'),
    'Development Rules #3 should reference canonical source'
  );
});

test('CLAUDE.md Development Rules #3 references /create-pr Step 4b', () => {
  assert.ok(
    claudeContent.includes('Step 4b'),
    'Development Rules #3 should mention /create-pr Step 4b enforcement'
  );
});

// --- Tests: .claude/CLAUDE.md mirror ---
// .claude/ is in .gitignore — file only exists locally (plugin install), not in CI checkout

test('.claude/CLAUDE.md mirrors PR title/body rule from CLAUDE.md', { skip: !existsSync(resolve(root, '.claude/CLAUDE.md')) && 'file not present (CI or fresh checkout)' }, () => {
  const dotClaudePath = resolve(root, '.claude/CLAUDE.md');
  const dotClaude = readFileSync(dotClaudePath, 'utf8');
  assert.ok(
    dotClaude.includes('PR title/body'),
    '.claude/CLAUDE.md should mention PR title/body'
  );
  assert.ok(
    dotClaude.includes('commit-msg-guard.sh'),
    '.claude/CLAUDE.md should reference canonical source'
  );
  assert.ok(
    dotClaude.includes('Step 4b'),
    '.claude/CLAUDE.md should reference Step 4b'
  );
});
