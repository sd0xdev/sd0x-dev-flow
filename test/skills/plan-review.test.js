const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, lstatSync, realpathSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/plan-review/SKILL.md');

// --- SKILL.md structure assertions ---

test('plan-review SKILL.md exists with valid frontmatter', () => {
  assert.ok(existsSync(skillPath), 'skills/plan-review/SKILL.md should exist');
  const content = readFileSync(skillPath, 'utf8');
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fmMatch, 'should have frontmatter block');
  assert.match(fmMatch[1], /^name:\s*plan-review/m, 'name should be plan-review');
  assert.match(fmMatch[1], /^description:/m, 'should have description');
  assert.match(fmMatch[1], /^allowed-tools:/m, 'should have allowed-tools');
  assert.match(fmMatch[1], /Bash\(node:\*\)/, 'allowed-tools should include the transport grant');
  assert.doesNotMatch(fmMatch[1], /mcp__codex/, 'the MCP transport grant is retired');
});

test('plan-review SKILL.md has Trigger and When NOT to Use sections', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /## Trigger/i, 'should have Trigger section');
  assert.match(content, /When NOT to Use/i, 'should have When NOT to Use section');
  assert.match(content, /codex-review-doc|doc-review/i, 'should route .md review elsewhere');
  assert.match(content, /review-spec/i, 'should route lifecycle spec review elsewhere');
});

test('plan-review SKILL.md defines the tier ladder (quick/standard/deep)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /--quick/, 'should document --quick');
  assert.match(content, /--deep/, 'should document --deep');
  assert.match(content, /codex-brainstorm/, 'deep tier should delegate to codex-brainstorm');
  assert.match(content, /--skip-review/, 'should document --skip-review escape');
});

test('plan-review SKILL.md is fully behaviour-layer: no gate emitter, no state file', () => {
  // Hook-lightweighting § 3.3: emit-plan-gate.sh and the plan_review state were
  // deleted with the hook that parsed them. The loop's bookkeeping now lives in
  // the conversation, and a skill text still invoking the emitter would stop the
  // whole review at a missing-script error.
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(!content.includes('emit-plan-gate'), 'the deleted gate emitter must not be invoked');
  assert.ok(!content.includes('.claude_review_state'), 'the deleted state file must not be referenced');
  assert.ok(!/post-tool-review-state|stop-guard\.sh/.test(content), 'no deleted hook may be named as a parser');
  assert.match(content, /round\s+counter lives \*\*in this conversation\*\*/i, 'round bookkeeping must be declared in-conversation');
  assert.match(content, /No hook parses these/i, 'the sentinel table must state its behaviour-layer status');
});

test('plan-review SKILL.md declares the full plan sentinel namespace', () => {
  const content = readFileSync(skillPath, 'utf8');
  for (const sentinel of ['## Plan Review', '✅ Plan Ready', '⛔ Plan Blocked', '⚠️ Plan Needs Human', '[PLAN_REVIEW_DEGRADED]', '[PLAN_REVIEW_SKIPPED]']) {
    assert.ok(content.includes(sentinel), `should declare sentinel: ${sentinel}`);
  }
});

test('plan-review SKILL.md forbids bare code/doc sentinels in plan output', () => {
  const content = readFileSync(skillPath, 'utf8');
  const forbiddenSection = content.match(/\*\*Forbidden\*\*[\s\S]*?(?=\n## )/);
  assert.ok(forbiddenSection, 'should have a Forbidden constraint block');
  assert.match(forbiddenSection[0], /✅ Ready/, 'should forbid bare ✅ Ready');
  assert.match(forbiddenSection[0], /✅ Mergeable/, 'should forbid bare ✅ Mergeable');
  assert.match(forbiddenSection[0], /## Gate:/, 'should forbid ## Gate:');
});

test('plan-review SKILL.md has redaction contract with fail-closed high-confidence path', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /scanHighConfidence/, 'should use scanHighConfidence');
  assert.match(content, /maskMediumConfidence/, 'should use maskMediumConfidence');
  assert.match(content, /secret-detected/, 'high-confidence hit should degrade with secret-detected');
});

test('plan-review SKILL.md has convergence table with max_rounds default 5', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /max_rounds/, 'should reference max_rounds');
  assert.match(content, /Plan Review Max Rounds/, 'should reference the project override heading');
  assert.match(content, /default 5/i, 'plan budget default should be 5');
});

test('plan-review SKILL.md has Verification checklist and Examples', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /## Verification/i, 'should have Verification section');
  assert.match(content, /\[[ x]\]/, 'should have checklist items');
  assert.match(content, /## Examples/i, 'should have Examples section');
});


// --- Reference file assertions ---

test('codex-prompt-plan.md exists with independent research mandate and plan sentinels', () => {
  const path = resolve(root, 'skills/plan-review/references/codex-prompt-plan.md');
  assert.ok(existsSync(path), 'codex-prompt-plan.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /independently research/i, 'must mandate independent research (codex-invocation rule)');
  assert.match(content, /git status/, 'research block should include git commands');
  // The template is body-only since the exec transport landed: the sandbox and approval policy are
  // pinned by codex-transport.md § Start, so a prompt template must NOT carry them.
  assert.doesNotMatch(content, /sandbox: '/, 'the template must not choose a sandbox');
  assert.doesNotMatch(content, /'approval-policy':/, 'the template must not choose an approval policy');
  assert.doesNotMatch(content, /mcp__codex/, 'the template must not name a transport tool');
  assert.ok(content.includes('## Plan Review'), 'output format must use ## Plan Review header');
  assert.ok(content.includes('✅ Plan Ready'), 'must define ✅ Plan Ready gate');
  assert.ok(content.includes('⛔ Plan Blocked'), 'must define ⛔ Plan Blocked gate');
  assert.match(content, /NEVER output the bare strings/, 'must forbid bare code/doc sentinels');
});

test('codex-prompt-plan.md frames the plan as a candidate artifact to attack', () => {
  const path = resolve(root, 'skills/plan-review/references/codex-prompt-plan.md');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /CANDIDATE ARTIFACT/i, 'plan must be framed as candidate artifact');
  assert.match(content, /Do NOT trust any claim inside the plan/i, 'must instruct distrust of plan claims');
});

test('review-loop-plan.md exists with verify-not-confirm loop contract', () => {
  const path = resolve(root, 'skills/plan-review/references/review-loop-plan.md');
  assert.ok(existsSync(path), 'review-loop-plan.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /§ Resume/, 'loop rounds use the transport § Resume');
  assert.match(content, /threadId/i, 'must reference saved threadId');
  assert.match(content, /introduce NEW issues/i, 'must ask whether fixes introduced new issues');
  assert.ok(content.includes('## Plan Review'), 'loop output must keep ## Plan Review header');
  assert.match(content, /NEVER output the bare strings/, 'must repeat bare-sentinel prohibition');
});

// --- Install shape ---
// .claude/skills is a directory symlink to ../skills (single source of truth), so a
// content-parity check would compare a file to itself. Assert the install shape
// instead: the symlink resolves into skills/ and every bundled file is reachable
// through it.

test('.claude/skills/plan-review resolves through the skills symlink to source files', (t) => {
  const installRoot = resolve(root, '.claude/skills');
  // .claude/ is gitignored local install state — absent in fresh clones,
  // worktrees, and CI. The install-shape check only applies when installed.
  if (!existsSync(installRoot)) {
    t.skip('.claude/skills not present (gitignored local install state)');
    return;
  }
  const st = lstatSync(installRoot);
  if (st.isSymbolicLink()) {
    assert.equal(
      realpathSync(installRoot),
      realpathSync(resolve(root, 'skills')),
      '.claude/skills symlink should resolve to skills/'
    );
  }
  for (const rel of ['SKILL.md', 'references/codex-prompt-plan.md', 'references/review-loop-plan.md']) {
    const src = resolve(root, 'skills/plan-review', rel);
    const dst = resolve(root, '.claude/skills/plan-review', rel);
    assert.ok(existsSync(dst), `.claude/skills/plan-review/${rel} should exist`);
    assert.equal(readFileSync(dst, 'utf8'), readFileSync(src, 'utf8'), `${rel} should be in sync with skills/`);
  }
});

// --- Registration assertions ---

test('plan-review is registered in docs/skill-catalog.yml', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /command: \/plan-review/, 'catalog should list /plan-review');
});

test('rules/auto-loop.md sentinel table includes plan namespace rows', () => {
  const content = readFileSync(resolve(root, 'rules/auto-loop.md'), 'utf8');
  for (const sentinel of ['✅ Plan Ready', '⛔ Plan Blocked', '⚠️ Plan Needs Human', '[PLAN_REVIEW_DEGRADED]', '[PLAN_REVIEW_SKIPPED]']) {
    assert.ok(content.includes(sentinel), `auto-loop.md should list sentinel: ${sentinel}`);
  }
});

test('rules/auto-loop-project.md has Plan Review opt-in sections', () => {
  const content = readFileSync(resolve(root, 'rules/auto-loop-project.md'), 'utf8');
  assert.match(content, /^## Plan Review$/m, 'should have ## Plan Review section');
  assert.match(content, /^## Plan Review Max Rounds$/m, 'should have ## Plan Review Max Rounds section');
});

// --- Heredoc delimiter randomization (secondary review iter-21 P2) ---
// The delimiter randomization is a real command-injection fix: a quoted heredoc stops shell
// INTERPOLATION of plan text, but not TERMINATION — a plan line reading exactly `PLAN_EOF` ends
// the here-document early and everything after it is executed as shell under this skill's `Bash`
// permission. Plan text is routinely drafted from untrusted material (issue bodies, PR
// descriptions, pasted logs), so that is arbitrary execution driven by attacker-supplied prose.
//
// The skill's own rationale is that "a fixed delimiter makes the attack a copy-paste" — which is
// precisely what shipping a concrete literal in the example did. A model that copies the example
// rather than generating a suffix gets the fixed delimiter back, and the mitigation reads as
// applied while being absent.

test('plan-review SKILL.md ships NO concrete heredoc delimiter literal', () => {
  const content = readFileSync(skillPath, 'utf8');
  const concrete = [...content.matchAll(/PLAN_EOF_([A-Za-z0-9]+)/g)].map((m) => m[1]);
  assert.deepEqual(
    concrete,
    [],
    `the example must use a placeholder, not a copyable value (found: ${concrete.join(', ')})`
  );
});

test('plan-review SKILL.md renders the delimiter as a generated placeholder', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /PLAN_EOF_<random-hex>/, 'the example must read as a slot to fill');
});

test('plan-review SKILL.md still mandates generate-and-collision-check', () => {
  // Guards the other direction: removing the literal must not quietly remove the requirement.
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /freshly randomized per invocation/i);
  assert.match(content, /collision/i, 'the collision re-check must remain mandated');
  assert.match(content, /≥8 hex chars|>=8 hex chars/, 'the suffix length floor must remain stated');
});
