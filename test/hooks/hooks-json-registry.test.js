const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');

const hooksJsonPath = resolve(__dirname, '../../hooks/hooks.json');
const hooksConfig = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));

test('hooks.json is valid JSON with hooks key', () => {
  assert.ok(hooksConfig.hooks, 'should have hooks key');
  assert.ok(hooksConfig.hooks.SessionStart, 'should have SessionStart entries');
});

test('namespace-hint SessionStart hook uses "startup|compact" matcher, not empty string', () => {
  const sessionStartEntries = hooksConfig.hooks.SessionStart;
  const namespaceHintEntry = sessionStartEntries.find(
    (e) => e.hooks?.some((h) => h.command?.includes('namespace-hint'))
  );

  assert.ok(namespaceHintEntry, 'should have namespace-hint SessionStart entry');
  assert.equal(
    namespaceHintEntry.matcher,
    'startup|compact',
    'namespace-hint matcher must be "startup|compact" to inject namespace guidance on startup ' +
    'and after compaction, but NOT on resume where CLAUDE_PLUGIN_ROOT may be unavailable'
  );
});

test('post-compact-auto-loop SessionStart hook uses "compact" matcher', () => {
  const sessionStartEntries = hooksConfig.hooks.SessionStart;
  const compactEntry = sessionStartEntries.find(
    (e) => e.hooks?.some((h) => h.command?.includes('post-compact-auto-loop'))
  );

  assert.ok(compactEntry, 'should have post-compact-auto-loop SessionStart entry');
  assert.equal(compactEntry.matcher, 'compact', 'post-compact hook matcher must be "compact"');
});

test('UserPromptSubmit hook registered for user-prompt-review-guard', () => {
  const upsEntries = hooksConfig.hooks.UserPromptSubmit;
  assert.ok(upsEntries, 'should have UserPromptSubmit entries');
  assert.ok(upsEntries.length >= 1, 'should have at least 1 UserPromptSubmit hook');
  const guardEntry = upsEntries.find(
    (e) => e.hooks?.some((h) => h.command?.includes('user-prompt-review-guard'))
  );
  assert.ok(guardEntry, 'should have user-prompt-review-guard UserPromptSubmit entry');
});

test('no SessionStart hook uses empty matcher', () => {
  const sessionStartEntries = hooksConfig.hooks.SessionStart;
  const emptyMatcherEntries = sessionStartEntries.filter((e) => e.matcher === '');

  assert.equal(
    emptyMatcherEntries.length,
    0,
    'no SessionStart hook should use empty matcher "" — ' +
    'each hook must specify explicit matcher (startup, compact, resume) ' +
    'to avoid errors when CLAUDE_PLUGIN_ROOT is unavailable on non-startup events'
  );
});

// Claude Code matchers are exact tool-name matches: "Edit|Write" alternates
// on Edit and Write but never fires for NotebookEdit. The edit hooks read
// tool_input.notebook_path as a fallback, so they MUST be dispatched for
// NotebookEdit or that fallback is dead code and notebook edits bypass both
// the sensitive-file guard (PreToolUse) and the review-gate tracker (PostToolUse).
for (const { event, script } of [
  { event: 'PreToolUse', script: 'pre-edit-guard' },
  { event: 'PostToolUse', script: 'post-edit-format' },
]) {
  test(`${event} ${script} matcher includes NotebookEdit`, () => {
    const entry = hooksConfig.hooks[event].find(
      (e) => e.hooks?.some((h) => h.command?.includes(script))
    );
    assert.ok(entry, `should have ${script} ${event} entry`);
    const alts = entry.matcher.split('|');
    assert.ok(
      alts.includes('NotebookEdit'),
      `${script} matcher "${entry.matcher}" must include NotebookEdit so notebook ` +
      'edits are dispatched to the hook (matchers are exact tool-name matches)'
    );
    assert.ok(alts.includes('Edit') && alts.includes('Write'), 'must still cover Edit and Write');
  });
}
