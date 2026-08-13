const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/review-spec/SKILL.md');
const sentinelSourcePath = resolve(root, 'rules/auto-loop.md');

function skill() {
  return readFileSync(skillPath, 'utf8');
}

test('review-spec SKILL.md exists with frontmatter declaring the Codex MCP tools', () => {
  assert.ok(existsSync(skillPath), 'skills/review-spec/SKILL.md should exist');
  const fm = skill().match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fm, 'should have a frontmatter block');
  assert.match(fm[1], /^name:\s*review-spec/m, 'name should be review-spec');
  assert.match(fm[1], /^description:/m, 'should have a description');
  assert.match(fm[1], /^allowed-tools:.*mcp__codex__codex/m, 'allowed-tools should declare Codex MCP');
  assert.match(fm[1], /mcp__codex__codex-reply/, 'allowed-tools should allow the loop re-review');
});

// The whole point of the conversion: an Agent-dispatched review closes no gate, because the hook
// binds a doc verdict to an MCP request that asked for a `Document Review`. A frontmatter that
// still declares `Agent` would let the old path be taken silently.
test('review-spec SKILL.md no longer declares the Agent tool', () => {
  const fm = skill().match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.doesNotMatch(
    fm[1],
    /(^|[,\s])Agent([,\s]|$)/,
    'allowed-tools must not declare Agent — an Agent dispatch records no doc-plane verdict'
  );
});

test('review-spec dispatch carries the request-side provenance phrase', () => {
  const content = skill();
  assert.match(content, /mcp__codex__codex\(\{/, 'should dispatch via mcp__codex__codex');
  assert.ok(
    content.includes('Document Review'),
    'the dispatched prompt must contain "Document Review" — the hook\'s request-side discriminator'
  );
  assert.match(
    content,
    /sandbox:\s*'read-only'/,
    'review dispatch should be read-only per rules/codex-invocation.md'
  );
  assert.match(content, /'approval-policy':\s*'never'/, 'review dispatch should not prompt for approval');
});

// Both directions, same file: the parsed pair must be present, and the unparseable vocabulary the
// skill used to emit must be gone. The negative half is what actually failed before this change —
// `✅ Approved` and `❌ Needs redesign` recorded no verdict at all, pass or fail.
test('review-spec emits the parsed doc-plane sentinel pair and no unparseable verdict vocabulary', () => {
  const content = skill();
  assert.ok(content.includes('✅ Mergeable'), 'should emit the doc-plane pass sentinel');
  assert.ok(content.includes('⛔ Needs revision'), 'should emit the doc-plane block sentinel');
  for (const stale of ['✅ Approved', '❌ Needs redesign', '⚠️ Needs revision']) {
    assert.ok(
      !content.includes(stale),
      `"${stale}" is not parsed by the doc-plane hook and must not appear as a verdict`
    );
  }
});

// Negative control for the assertion above: the sentinels this skill emits are exactly the pair
// rules/auto-loop.md § Gate Sentinels defines for the doc plane. Reading them from the rule
// rather than restating them means a rule-side rename fails here instead of silently splitting
// the vocabulary.
test('the sentinels review-spec emits are the ones rules/auto-loop.md defines', () => {
  const rule = readFileSync(sentinelSourcePath, 'utf8');
  for (const sentinel of ['✅ Mergeable', '⛔ Needs revision']) {
    assert.ok(rule.includes(sentinel), `rules/auto-loop.md should define ${sentinel}`);
    assert.ok(skill().includes(sentinel), `skill should emit ${sentinel}`);
  }
});

test('review-spec SKILL.md documents its scope boundaries and the shared loop', () => {
  const content = skill();
  assert.match(content, /## Trigger/, 'should have a Trigger section');
  assert.match(content, /When NOT to Use/, 'should have a When NOT to Use section');
  assert.match(content, /codex-review-fast/, 'should route code review elsewhere');
  assert.match(content, /doc-review/, 'should point at the shared doc-review loop mechanics');
  assert.match(content, /NIT_DEFERRED/, 'should carry the sub-threshold logging contract');
});
