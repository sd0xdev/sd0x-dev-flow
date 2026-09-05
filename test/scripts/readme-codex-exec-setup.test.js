'use strict';
// Pins the Codex exec setup block in all six READMEs.
//
// Renamed from `readme-codex-mcp.test.js`, which pinned `claude mcp add codex -- codex mcp-server`
// and the `--profile`-cannot-be-used-with-mcp-server rule. Both belonged to a transport that
// codex-cli 0.149.0 deprecated: there is no server to register, and `-p` is now the supported way to
// carry model and reasoning settings. Work item 5 of docs/features/codex-exec-transport/.
//
// The old file pinned English only. This one covers all six, because the five locale mirrors are
// hand-maintained and drifting silently is exactly what they do.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { readFileSync } = require('node:fs');

const ROOT = resolve(__dirname, '../..');
const READMES = ['README.md', 'README.es.md', 'README.ja.md', 'README.ko.md',
  'README.zh-CN.md', 'README.zh-TW.md'];

// Facts every locale must carry, whatever language the prose around them is in. Each is verifiable
// against `codex exec --help` on codex-cli 0.149.0.
const REQUIRED = [
  [/codex-exec\.js/, 'names the adapter the setup installs'],
  [/install-scripts/, 'names the install route'],
  [/## Codex Profile/, 'names the setting that selects a profile'],
  [/\$CODEX_HOME\/<name>\.config\.toml/, 'names the profile-v2 file the name resolves to'],
  [/0\.149/, 'names the CLI version the transport requires'],
];

const setupSection = (text) => {
  // The heading is localised; the fence that installs the adapter is not.
  const i = text.indexOf('codex-exec.js');
  assert.notEqual(i, -1, 'the setup block must exist');
  const start = text.lastIndexOf('\n### ', i);
  assert.notEqual(start, -1, 'the block must sit under its own heading');
  // The section's own example shows `## Codex Profile` inside a ```markdown fence, so a naive
  // "next \n## " boundary cuts the section in half and drops the very facts this test checks.
  // Walk the lines and track fence state instead.
  const lines = text.slice(start).split('\n');
  let inFence = false;
  const body = [];
  for (const [n, line] of lines.entries()) {
    if (/^```/.test(line)) inFence = !inFence;
    if (n > 0 && !inFence && /^## /.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
};

for (const name of READMES) {
  const readme = () => readFileSync(join(ROOT, name), 'utf8');

  test(`${name}: the setup block states every fact a reader needs`, () => {
    const section = setupSection(readme());
    for (const [pattern, why] of REQUIRED) {
      assert.match(section, pattern, `${name} ${why}`);
    }
  });

  test(`${name}: no registration command survives`, () => {
    const text = readme();
    assert.doesNotMatch(text, /claude mcp add codex/,
      'the MCP registration command is gone — there is no server to register');
    // `mcp-server` may still be *named*, but only in the sentence saying it is deprecated. A bash
    // fence containing it would be a runnable instruction.
    const bashFences = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
    for (const fence of bashFences) {
      assert.doesNotMatch(fence, /mcp-server/,
        `${name}: no runnable fence may invoke the deprecated server — found: ${fence.slice(0, 80)}`);
    }
  });
}

// ── Controls, both directions ────────────────────────────────────────────────

test('control: the required-fact list is not vacuous — it fires on a block missing a fact', () => {
  // replaceAll, not replace: the file names the profile path more than once, and removing only the
  // first left the pattern matching further down — the control passed while proving nothing.
  const stripped = readFileSync(join(ROOT, 'README.md'), 'utf8')
    .replaceAll('$CODEX_HOME/<name>.config.toml', 'somewhere');
  const section = setupSection(stripped);
  const missing = REQUIRED.filter(([p]) => !p.test(section));
  assert.equal(missing.length, 1, 'removing one required fact must leave exactly one unmatched');
});

test('control: a reintroduced registration command is caught', () => {
  const regressed = 'claude mcp add codex -- codex mcp-server -c \'model_reasoning_effort="high"\'';
  assert.match(regressed, /claude mcp add codex/, 'the pattern that guards against regression fires');
});

test('control: a runnable mcp-server fence is caught while the deprecation sentence is not', () => {
  const fenceForm = '```bash\ncodex mcp-server\n```';
  const proseForm = '`codex mcp-server` was deprecated in codex-cli 0.149.0.';
  const fences = (t) => [...t.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(fences(fenceForm).some((f) => /mcp-server/.test(f)), 'the fence form must be caught');
  assert.equal(fences(proseForm).length, 0, 'prose naming it is not a runnable instruction');
});

// A `bash` fence is an invitation to paste into a shell. A Claude Code slash command pasted there
// runs nothing — the shell reads `/sd0x-dev-flow:install-scripts` as an absolute path and fails —
// so the one step that installs the adapter would silently not happen. Found by review 2026-09-04,
// when all six READMEs carried the slash command inside the same fence as `codex --version`.
const bashFences = (text) => [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
const slashCommandLines = (fence) =>
  fence.split('\n').map((l) => l.trim()).filter((l) => /^\/[a-z0-9-]+(?::[a-z0-9-]+)?\s/.test(l));

for (const file of READMES) {
  test(`${file}: no bash fence tells the reader to run a slash command`, () => {
    const offenders = bashFences(readFileSync(join(ROOT, file), 'utf8')).flatMap(slashCommandLines);
    assert.deepEqual(offenders, [],
      `${file}: these are Claude Code commands and a shell cannot run them — put them in a text fence`);
  });
}

test('control: the slash-command detector fires on the shape it exists to catch', () => {
  const bad = '```bash\ncodex --version\n/sd0x-dev-flow:install-scripts codex-exec.js\n```';
  const good = '```text\n/sd0x-dev-flow:install-scripts codex-exec.js\n```';
  assert.deepEqual(bashFences(bad).flatMap(slashCommandLines),
    ['/sd0x-dev-flow:install-scripts codex-exec.js'], 'a slash command inside a bash fence is caught');
  assert.deepEqual(bashFences(good).flatMap(slashCommandLines), [],
    'the same command in a text fence is the correct form and is not a finding');
  assert.deepEqual(bashFences('```bash\ncd /usr/local && ls\n```').flatMap(slashCommandLines), [],
    'an ordinary shell line starting with a path is not a slash command');
});
