const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

const root = resolve(__dirname, '../..');
const skillDir = resolve(root, 'skills/orchestrate');
const skillPath = resolve(skillDir, 'SKILL.md');

// Hook-parsed sentinels that /orchestrate output (and its own docs) must never recite.
const HOOK_SENTINELS = ['## Gate:', '✅ Ready', '✅ Mergeable', '⛔ Blocked', '✅ All Pass'];

// --- SKILL.md structure assertions ---

test('orchestrate SKILL.md exists with valid frontmatter', () => {
  assert.ok(existsSync(skillPath), 'skills/orchestrate/SKILL.md should exist');
  const content = readFileSync(skillPath, 'utf8');
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fmMatch, 'should have frontmatter block');
  assert.match(fmMatch[1], /^name:\s*orchestrate/m, 'name should be orchestrate');
  assert.match(fmMatch[1], /^description:/m, 'should have description');
  assert.match(fmMatch[1], /^allowed-tools:.*AskUserQuestion/m, 'execute approval needs AskUserQuestion');
  assert.match(fmMatch[1], /^allowed-tools:.*Task/m, 'fanout dispatch needs Task');
});

test('orchestrate SKILL.md has Trigger, When NOT to Use, and Flags sections', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /## Trigger/i);
  assert.match(content, /When NOT to Use/i);
  assert.match(content, /--execute/, 'should document --execute');
  assert.match(content, /--resume/, 'should document --resume');
  assert.match(content, /--budget/, 'should document --budget');
});

test('orchestrate SKILL.md documents the baseline timing invariant (snapshot before any agent)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /先於任何 agent 派發/, 'snapshot must precede any agent dispatch (incl. planner)');
  assert.match(content, /run-verify\.js snapshot/, 'should name the snapshot command');
  assert.match(content, /同一 baseline/, 'post-execute compare must reuse the same baseline');
});

test('orchestrate SKILL.md resume is fail-closed (original baseline, no re-snapshot)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /原 baseline/, '--resume must compare against the original baseline');
  assert.match(content, /needs_human/, 'drift on resume → needs_human stop');
  assert.match(content, /不得重拍 baseline/, 'must forbid re-snapshot whitewash');
});

test('orchestrate SKILL.md output isolation: declares its own markers, never recites hook sentinels', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('## Orchestrate Run Summary'), 'should declare its run summary header');
  assert.ok(content.includes('[ORCHESTRATE_RUN]'), 'should declare its structured status line');
  for (const sentinel of HOOK_SENTINELS) {
    assert.ok(!content.includes(sentinel), `SKILL.md must not contain hook sentinel: ${sentinel}`);
  }
});

test('orchestrate skill files (docs + references) contain no hook sentinel literals (S1 self-compliance)', () => {
  const files = [
    'references/planner-prompt.md',
    'references/plan-schema.md',
    'references/execution-policy.md',
    'references/admission-allowlist.json',
  ];
  for (const rel of files) {
    const content = readFileSync(resolve(skillDir, rel), 'utf8');
    for (const sentinel of HOOK_SENTINELS) {
      assert.ok(!content.includes(sentinel), `${rel} must not contain hook sentinel: ${sentinel}`);
    }
  }
});

test('orchestrate SKILL.md two-plane separation: safety plane is read-only, run-state has no safety fields', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /\.claude_review_state\.json/, 'should name the safety plane file');
  assert.match(content, /只讀，永不寫/, 'orchestrator must be read-only on the safety plane');
  const schemaDoc = readFileSync(resolve(skillDir, 'references/plan-schema.md'), 'utf8');
  for (const field of ['code_review', 'doc_review', 'aggregate_gate']) {
    assert.ok(!content.includes(field), `SKILL.md run-state must not define safety field: ${field}`);
    assert.ok(!schemaDoc.includes(field), `plan-schema.md must not define safety field: ${field}`);
  }
});

test('orchestrate SKILL.md redaction + FIFO + done-only-via-doc-review contracts present', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /scanHighConfidence/, 'high-confidence secret scan must be named');
  assert.match(content, /abort fail-closed|abort.*fail-closed/i, 'high-confidence hit must abort, not mask');
  assert.match(content, /保留最近 10 個 run 檔/, 'FIFO 10 retention');
  assert.match(content, /`done` 的\*\*唯一路徑\*\*/, 'done reachable only via doc review Mergeable gate');
});

// --- Scripts and references existence ---

test('orchestrate bundles all three scripts and four references', () => {
  for (const rel of [
    'scripts/plan-context.js',
    'scripts/validate-plan.js',
    'scripts/run-verify.js',
    'references/planner-prompt.md',
    'references/plan-schema.md',
    'references/execution-policy.md',
    'references/admission-allowlist.json',
  ]) {
    assert.ok(existsSync(resolve(skillDir, rel)), `skills/orchestrate/${rel} should exist`);
  }
});

// --- Admission allowlist lock ---

test('admission allowlist is locked to Explore + performance-optimizer with documented exclusions', () => {
  const allowlist = JSON.parse(readFileSync(resolve(skillDir, 'references/admission-allowlist.json'), 'utf8'));
  assert.equal(allowlist.mode, 'deny-by-default');
  assert.deepEqual(
    allowlist.fanout_allowlist.map((e) => e.name).sort(),
    ['Explore', 'performance-optimizer'],
    'v1 allowlist is exactly these two entries'
  );
  const excluded = allowlist.explicit_exclusions.map((e) => e.name);
  assert.ok(excluded.includes('coverage-analyst'), 'coverage-analyst exclusion must be recorded');
  assert.ok(excluded.includes('git-investigator'), 'git-investigator exclusion must be recorded');
  for (const entry of allowlist.explicit_exclusions) {
    assert.ok(entry.reason && entry.reason.length > 0, `exclusion ${entry.name} must carry a reason`);
  }
});

test('admission allowlist expected_tools matches the live agent frontmatter (drift lock)', () => {
  const allowlist = JSON.parse(readFileSync(resolve(skillDir, 'references/admission-allowlist.json'), 'utf8'));
  for (const entry of allowlist.fanout_allowlist.filter((e) => e.type === 'repo-agent')) {
    const agentFile = resolve(root, 'agents', `${entry.name}.md`);
    assert.ok(existsSync(agentFile), `agents/${entry.name}.md should exist`);
    const toolsLine = readFileSync(agentFile, 'utf8').split('\n').find((l) => l.startsWith('tools:'));
    assert.equal(
      toolsLine.replace(/^tools:\s*/, '').trim(),
      entry.expected_tools,
      `agents/${entry.name}.md tools must equal allowlist expected_tools — re-review admission on change`
    );
  }
});

// --- Control plane gitignore ---

test('.claude_workflows/ run-state files are gitignored (control plane never enters the repo)', () => {
  const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.claude_workflows\/$/m, '.gitignore should list .claude_workflows/');
  let status = 0;
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '-q', '.claude_workflows/20260612-000000-sample.json']);
  } catch (err) {
    status = err.status;
  }
  assert.equal(status, 0, 'git check-ignore should confirm run-state paths are ignored');
});

// --- Registration assertions ---

test('orchestrate is registered in docs/skill-catalog.yml under planning', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /command: \/orchestrate/, 'catalog should list /orchestrate');
});

test('orchestrate appears in the CLAUDE.md command quick references', () => {
  for (const rel of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.template.md']) {
    const content = readFileSync(resolve(root, rel), 'utf8');
    assert.match(content, /\| `\/orchestrate` \|/, `${rel} quick reference should include /orchestrate`);
  }
});
