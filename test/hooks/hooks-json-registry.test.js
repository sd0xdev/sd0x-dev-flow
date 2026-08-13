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

// --- resume dispatch-log compaction (WB3 round-4 P2) -------------------------
//
// CLAUDE_PLUGIN_ROOT may be unavailable on resume (the matcher tests above
// document why). The compaction entry therefore must (a) resolve the CLI
// without it — installed copy or self-hosted scripts/ under $PWD — and
// (b) never skip silently: every unreachable-CLI mode says so on stderr.
// String-matching the command would pin spelling, not behaviour, so these
// EXECUTE it the way the harness would.

const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

function resumeCommand() {
  const entry = hooksConfig.hooks.SessionStart.find((e) => e.matcher === 'resume');
  assert.ok(entry, 'should have a SessionStart resume entry');
  return entry.hooks[0].command;
}

function runResume(cwd, input) {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.CLAUDE_PROJECT_DIR;
  env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), 'sd0x-resume-cache-'));
  const result = spawnSync('bash', ['-c', resumeCommand()], { cwd, encoding: 'utf8', env, input });
  rmSync(env.XDG_CACHE_HOME, { recursive: true, force: true });
  return result;
}

test('resume compaction without plugin root and without any CLI copy skips LOUDLY, not silently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-resume-empty-'));
  const result = runResume(dir, '{}');
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, 'SessionStart advisory — never blocks');
  assert.match(result.stderr, /resume compaction skipped/, 'a silent skip is the symptom-masking round 4 flagged');
  assert.match(result.stderr, /install-scripts/, 'the warning must name the repair');
});

test('resume compaction without plugin root still reaches the CLI via $PWD fallback and runs', () => {
  const repoRoot = resolve(__dirname, '../..');
  const tDir = mkdtempSync(join(tmpdir(), 'sd0x-resume-run-'));
  try {
    const t = join(tDir, 'transcript.jsonl');
    writeFileSync(t, JSON.stringify({ type: 'summary' }) + '\n');
    const payload = JSON.stringify({ session_id: 'sess-resume-reg', transcript_path: t });
    const result = runResume(repoRoot, payload);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /resume compaction skipped/);
    assert.match(result.stdout, /"ok":true/, 'compaction must actually run from the $PWD copy');
  } finally {
    rmSync(tDir, { recursive: true, force: true });
  }
});

test('the bare scripts/ fallback refuses an UNRELATED project — same-named CLI without the plugin manifest never executes', () => {
  // The provenance gate round 5 asked for: a consuming project can contain
  // any scripts/dispatch-cli.js it likes; existence is not evidence of a
  // self-hosted checkout, and the resume hook must not hand it to node.
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-resume-evil-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(
      join(dir, 'scripts', 'dispatch-cli.js'),
      'process.stderr.write("PWNED\\n"); process.exit(1);\n'
    );
    const result = runResume(dir, '{}');
    assert.equal(result.status, 0, 'SessionStart advisory — never blocks');
    assert.doesNotMatch(result.stderr, /PWNED/, 'an unverified project script must never execute');
    assert.match(result.stderr, /resume compaction skipped/, 'the refusal is loud, not silent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
