const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');

const ROOT = resolve(__dirname, '../..');
const skillPath = resolve(ROOT, 'skills/dep-audit/SKILL.md');

// deep-explore regression: permission prefixes use the colon form `Bash(cmd:*)`.
// The space form `Bash(npm audit *)` is not valid permission-rule grammar and
// silently fails to narrow — every audit command would prompt.

test('dep-audit allowed-tools uses colon-form Bash permission rules', () => {
  const frontmatter = readFileSync(skillPath, 'utf8').split('---')[1] || '';
  const allowedLine = frontmatter.split('\n').find((l) => l.startsWith('allowed-tools:'));
  assert.ok(allowedLine, 'dep-audit SKILL.md should declare allowed-tools');
  assert.ok(allowedLine.includes('Bash(npm audit:*)'), `expected colon form, got: ${allowedLine}`);
  assert.ok(allowedLine.includes('Bash(yarn audit:*)'), `expected colon form, got: ${allowedLine}`);
  assert.ok(allowedLine.includes('Bash(pnpm audit:*)'), `expected colon form, got: ${allowedLine}`);
  assert.ok(!/Bash\([a-z]+ audit \*\)/.test(allowedLine), `space-form rule found: ${allowedLine}`);
});
