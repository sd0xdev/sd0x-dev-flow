const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/debug/SKILL.md');
const refTaxonomy = resolve(root, 'skills/debug/references/failure-taxonomy.md');
const refProtocol = resolve(root, 'skills/debug/references/probe-protocol.md');
const refReport = resolve(root, 'skills/debug/references/report-template.md');

// --- File existence ---

test('debug skill directory and files exist', () => {
  assert.ok(existsSync(skillPath), 'SKILL.md should exist');
  assert.ok(existsSync(refTaxonomy), 'failure-taxonomy.md should exist');
  assert.ok(existsSync(refProtocol), 'probe-protocol.md should exist');
  assert.ok(existsSync(refReport), 'report-template.md should exist');
});

// --- SKILL.md frontmatter ---

test('debug SKILL.md has correct frontmatter', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /^---\s*\n/, 'should start with frontmatter');
  assert.match(content, /name:\s*debug/, 'name should be debug');
  assert.match(content, /description:/, 'should have description');
  assert.match(content, /allowed-tools:.*Read, Grep, Glob, Edit, Write, Bash/, 'should have base tools');
  assert.match(content, /allowed-tools:.*Skill/, 'should include Skill for sub-skill dispatch');
  // Corrected twice: this skill held MCP grants, and my first re-pin swapped them for the adapter
  // grant. A doc reviewer showed both were wrong — `debug` dispatches nothing itself. Phase 2 goes
  // through `/codex-brainstorm` and Phase 3 through `/seek-verdict`, both via the Skill tool, so it
  // is a router and `codex-transport.md` § Permission gives a router no transport grant.
  assert.match(content, /allowed-tools:.*\bSkill\b/, 'it routes through other skills');
  assert.doesNotMatch(content, /allowed-tools:.*Bash\(node:\*\)/, 'a router gets no adapter grant');
  assert.doesNotMatch(content, /mcp__codex/, 'the MCP grants are retired');
});

// --- SKILL.md structure ---

test('debug SKILL.md has Prohibited Actions block', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Prohibited Actions/, 'should have Prohibited Actions section');
  assert.match(content, /git add.*git commit.*git push/, 'should prohibit git operations');
});

test('debug SKILL.md has all 6 phases (0-5)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Phase 0.*Intake/i, 'should have Phase 0');
  assert.match(content, /Phase 1.*Classify/i, 'should have Phase 1');
  assert.match(content, /Phase 2.*Probe/i, 'should have Phase 2');
  assert.match(content, /Phase 3.*Root Cause/i, 'should have Phase 3');
  assert.match(content, /Phase 4.*Fix/i, 'should have Phase 4');
  assert.match(content, /Phase 5.*Report/i, 'should have Phase 5');
});

test('debug SKILL.md has Probe Safety Rules', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Probe Safety Rules/, 'should have safety rules section');
  assert.match(content, /Read-first default/, 'should have read-first rule');
  assert.match(content, /Deny list/, 'should have deny list');
  assert.match(content, /Redaction/, 'should have redaction rule');
  assert.match(content, /Timeout/, 'should have timeout rule');
});

test('debug SKILL.md has mandatory /seek-verdict integration', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /seek-verdict.*--intent confirm/, 'should reference seek-verdict with confirm intent');
  assert.match(content, /Mandatory/i, 'should mark as mandatory');
  assert.match(content, /Anti-anchoring/, 'should specify anti-anchoring contract');
  assert.match(content, /Fresh thread/, 'should require fresh thread');
});

test('debug SKILL.md has /codex-brainstorm escalation', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /codex-brainstorm/, 'should reference codex-brainstorm');
  assert.match(content, /competing hypotheses|競爭假設/i, 'should describe escalation condition');
});

test('debug SKILL.md has --export option', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /--export/, 'should document --export flag');
});

test('debug SKILL.md has auto-loop and Doc Sync references', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /auto-loop/, 'should reference auto-loop');
  assert.match(content, /Doc Sync/, 'should have Doc Sync section');
});

test('debug SKILL.md verification checklist includes no-git', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /No.*git add\/commit\/push/, 'should have no-git checklist item');
});

test('debug SKILL.md references all reference files', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /references\/failure-taxonomy\.md/, 'should reference failure-taxonomy');
  assert.match(content, /references\/probe-protocol\.md/, 'should reference probe-protocol');
  assert.match(content, /references\/report-template\.md/, 'should reference report-template');
});

// --- Failure Taxonomy ---

test('failure-taxonomy.md covers 6 problem types', () => {
  const content = readFileSync(refTaxonomy, 'utf8');
  assert.match(content, /Script Bug/, 'should have Script Bug');
  assert.match(content, /API Error/, 'should have API Error');
  assert.match(content, /Config Issue/, 'should have Config Issue');
  assert.match(content, /Silent Failure/, 'should have Silent Failure');
  assert.match(content, /Race Condition/, 'should have Race Condition');
  assert.match(content, /Dependency Issue/, 'should have Dependency Issue');
});

// --- Probe Protocol ---

test('probe-protocol.md has termination criteria', () => {
  const content = readFileSync(refProtocol, 'utf8');
  assert.match(content, /Termination/, 'should have termination section');
  assert.match(content, /stagnation/i, 'should mention stagnation');
  assert.match(content, /max rounds/i, 'should mention max rounds');
});

// --- Trigger keyword conflict check ---

test('debug trigger keywords do not overlap with bug-fix or issue-analyze', () => {
  const debugContent = readFileSync(skillPath, 'utf8');
  // debug should NOT trigger on issue-analyze keywords
  const debugTrigger = debugContent.match(/## Trigger[\s\S]*?## /)?.[0] || '';
  assert.doesNotMatch(debugTrigger, /analyze issue/i, 'should not overlap with issue-analyze');
  assert.doesNotMatch(debugTrigger, /triage review/i, 'should not overlap with issue-analyze');
});
