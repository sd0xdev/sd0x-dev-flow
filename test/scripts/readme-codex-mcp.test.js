const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { readFileSync } = require('node:fs');

const ROOT = resolve(__dirname, '../..');
const README_PATH = join(ROOT, 'README.md');
const SECTION_HEADING = '### Codex MCP registration';

// The pinned form both the real assertion and every mutation control below compare
// against. Relaxing this constant (e.g. to a looser regex) changes what the controls
// guard too, since they reference it rather than duplicating their own copy.
const REGISTRATION_CMD = `claude mcp add codex -- codex mcp-server -c 'model_reasoning_effort="high"'`;

function sectionOf(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `heading not found in README: ${heading}`);
  const afterHeading = start + heading.length;
  const nextHeading = text.slice(afterHeading).match(/\n#{2,3} /);
  const end = nextHeading ? afterHeading + nextHeading.index : text.length;
  return text.slice(start, end);
}

// ── Positive: the shipped registration block is well-formed ──────────────

test('README Codex MCP registration command is the pinned mcp-server -c form', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const section = sectionOf(readme, SECTION_HEADING);
  const fence = section.match(/```bash\n([^\n]*)\n```/);
  assert.ok(fence, 'a ```bash fence with the registration command must exist under the heading');
  assert.equal(fence[1], REGISTRATION_CMD, `registration command must be the pinned form, got: ${fence[1]}`);
});

test('README documents that --profile cannot be used with mcp-server', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const section = sectionOf(readme, SECTION_HEADING);
  assert.match(section, /--profile.*\*\*cannot\*\*.*mcp-server/s,
    'the anti-pattern must be stated as a hard incompatibility, not a soft recommendation');
  assert.ok(section.includes('codex-cli 0.146.0'),
    'the probed version must be recorded next to the claim');
});

test('README does not instruct --profile as a runnable way to configure mcp-server', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const section = sectionOf(readme, SECTION_HEADING);
  // The explanatory error quote lives in a ```text fence (not ```bash), so any
  // --profile inside a ```bash fence would be a runnable instruction, not documentation.
  const bashFences = [...section.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const fence of bashFences) {
    assert.ok(!/--profile(\s|=)\S+/.test(fence),
      `--profile must never appear inside a runnable bash fence, found in: ${fence}`);
  }
});

// ── Negative control: a regressed command must fail the positive assertion ──
// Both controls compare against REGISTRATION_CMD directly — the same constant the
// positive test uses — so relaxing that constant changes what these controls catch.

test('control: a command missing the -c override fails the pinned-form assertion', () => {
  const badCmd = 'claude mcp add codex -- codex mcp-server';
  assert.notEqual(badCmd, REGISTRATION_CMD,
    'a command without the -c default must not match the pinned form');
});

test('control: -c placed before the mcp-server subcommand fails the pinned-form assertion', () => {
  const badCmd = "claude mcp add codex -- codex -c 'model_reasoning_effort=\"high\"' mcp-server";
  assert.notEqual(badCmd, REGISTRATION_CMD,
    '-c before mcp-server must not match the pinned after-subcommand form');
});
