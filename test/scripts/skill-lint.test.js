'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const {
  checkAgentEntitlement,
  checkTaskEntitlement,
  checkSkillEntitlement,
  checkCrossSkillRefPaths,
  detectInvalidAgentRefs,
  detectAgentToolsSyntax,
} = require('../../skills/skill-health-check/scripts/skill-lint.js');

// ---------------------------------------------------------------------------
// checkAgentEntitlement
// ---------------------------------------------------------------------------

describe('checkAgentEntitlement', () => {
  test('when body has Agent() and allowed-tools has Agent -> pass', () => {
    const body = 'Use Agent({ subagent_type: "Explore", prompt: "..." })';
    const fm = { 'allowed-tools': 'Read, Grep, Agent' };
    const result = checkAgentEntitlement(body, fm);
    assert.equal(result.pass, true);
  });

  test('when body has Agent() but allowed-tools lacks Agent -> P2', () => {
    const body = 'Use Agent({ subagent_type: "Explore", prompt: "..." })';
    const fm = { 'allowed-tools': 'Read, Grep, Glob' };
    const result = checkAgentEntitlement(body, fm);
    assert.equal(result.pass, false);
    assert.equal(result.severity, 'P2');
  });

  test('when body has subagent_type only (Task dispatch) -> pass (not Agent)', () => {
    const body = '  subagent_type: "strict-reviewer"';
    const fm = { 'allowed-tools': 'Read, Grep, Task' };
    const result = checkAgentEntitlement(body, fm);
    assert.equal(result.pass, true);
  });

  test('when body has no agent references -> pass', () => {
    const body = 'This skill does simple file operations.';
    const fm = { 'allowed-tools': 'Read, Grep' };
    const result = checkAgentEntitlement(body, fm);
    assert.equal(result.pass, true);
  });

  test('when fm is null -> pass', () => {
    const body = 'Agent({ prompt: "hello" })';
    const result = checkAgentEntitlement(body, null);
    assert.equal(result.pass, true);
  });
});

// ---------------------------------------------------------------------------
// checkTaskEntitlement
// ---------------------------------------------------------------------------

describe('checkTaskEntitlement', () => {
  test('when body has Task() and allowed-tools has Task -> pass', () => {
    const body = 'Launch Task({ prompt: "run tests" })';
    const fm = { 'allowed-tools': 'Read, Task, Bash' };
    const result = checkTaskEntitlement(body, fm);
    assert.equal(result.pass, true);
  });

  test('when body has Task() but allowed-tools lacks Task -> P2', () => {
    const body = 'Launch Task({ prompt: "run tests" })';
    const fm = { 'allowed-tools': 'Read, Bash' };
    const result = checkTaskEntitlement(body, fm);
    assert.equal(result.pass, false);
    assert.equal(result.severity, 'P2');
  });

  test('when body has TaskCreate but no Task in allowed-tools -> P2', () => {
    const body = 'Use TaskCreate to track progress';
    const fm = { 'allowed-tools': 'Read, Bash' };
    const result = checkTaskEntitlement(body, fm);
    assert.equal(result.pass, false);
    assert.equal(result.severity, 'P2');
  });

  test('when no task references -> pass', () => {
    const body = 'Simple skill with no task dispatch.';
    const fm = { 'allowed-tools': 'Read' };
    const result = checkTaskEntitlement(body, fm);
    assert.equal(result.pass, true);
  });
});

// ---------------------------------------------------------------------------
// checkSkillEntitlement
// ---------------------------------------------------------------------------

describe('checkSkillEntitlement', () => {
  test('when body has Skill() and allowed-tools has Skill -> pass', () => {
    const body = 'Then Skill("codex-brainstorm", plan challenge)';
    const fm = { 'allowed-tools': 'Read, Grep, Task, Skill' };
    const result = checkSkillEntitlement(body, fm);
    assert.equal(result.pass, true);
  });

  test('when body has Skill() but allowed-tools lacks Skill -> P2', () => {
    const body = 'Then Skill("codex-brainstorm", plan challenge)';
    const fm = { 'allowed-tools': 'Read, Grep, Task' };
    const result = checkSkillEntitlement(body, fm);
    assert.equal(result.pass, false);
    assert.equal(result.severity, 'P2');
  });

  test('when body mentions /codex-review-doc in prose only -> pass (no Skill() call)', () => {
    const body = 'Write 報告 → /codex-review-doc 接手 (main-loop handoff)';
    const fm = { 'allowed-tools': 'Read, Grep, Task' };
    const result = checkSkillEntitlement(body, fm);
    assert.equal(result.pass, true);
  });

  test('when body has SkillCreate (not Skill dispatch) -> pass', () => {
    const body = 'Use SkillCreate helper — not the Skill tool';
    const fm = { 'allowed-tools': 'Read, Grep' };
    const result = checkSkillEntitlement(body, fm);
    assert.equal(result.pass, true);
  });

  test('when body has prose "Skill (" with a space (a heading, not a call) -> pass (no false positive)', () => {
    // Real dispatch is always `Skill("name")` with no space. A heading like
    // "# Codex Architect Skill (Third Brain)" must NOT be treated as a Skill() call.
    const body = '# Codex Architect Skill (Third Brain)\n\nConsult Codex for architecture advice.';
    const fm = { 'allowed-tools': 'Read, Grep, Bash(codex:*)' };
    const result = checkSkillEntitlement(body, fm);
    assert.equal(result.pass, true, 'prose "Skill (" with a space is not a dispatch call');
  });

  test('when fm is null -> pass', () => {
    const body = 'Skill("codex-brainstorm")';
    const result = checkSkillEntitlement(body, null);
    assert.equal(result.pass, true);
  });

  test('allowed-tools is matched as a whole ENTRY, not by word boundary or substring', () => {
    // The entitlement side used `/\bSkill\b/.test(tools)`, which is weaker than it reads. Every
    // punctuation character that appears in this format — `(`, `-`, `:` — is a NON-word character
    // and therefore supplies the boundary itself, so the regex accepted entries that grant nothing
    // of the sort. `Bash(Skill:*)` is permission to run a shell command named `Skill`;
    // `Some-Tool-Skill` is a different tool. `allowed-tools` is a comma-separated list, so the
    // check has to compare entries, not scan text.
    const body = 'Then Skill("codex-brainstorm")';
    const denied = [
      'Read, SkillRunner',
      'Read, MySkill',
      'Read, Skills',
      'Bash(Skill:*)',              // a Bash grant, not a Skill grant — `\bSkill\b` matched it
      'Read, Some-Tool-Skill',      // hyphens are non-word characters, so both boundaries held
      'Read, Skill-Runner',
    ];
    for (const tools of denied) {
      const r = checkSkillEntitlement(body, { 'allowed-tools': tools });
      assert.equal(r.pass, false, `${JSON.stringify(tools)} must NOT grant the Skill entitlement`);
    }
    // The complement: a genuine grant must still be recognised wherever it sits in the list, and
    // whatever surrounds it. Without these, "deny everything" would pass the above.
    for (const tools of ['Skill', 'Read, Skill', 'Read, Skill, Grep', 'Skill, Read', 'Read,  Skill ']) {
      const r = checkSkillEntitlement(body, { 'allowed-tools': tools });
      assert.equal(r.pass, true, `${JSON.stringify(tools)} MUST grant the Skill entitlement`);
    }
  });
});

// ---------------------------------------------------------------------------
// checkCrossSkillRefPaths
// ---------------------------------------------------------------------------

describe('checkCrossSkillRefPaths', () => {
  let tmpDir;

  function setup(structure) {
    tmpDir = mkdtempSync(join(tmpdir(), 'xref-test-'));
    for (const [path, content] of Object.entries(structure)) {
      const full = join(tmpDir, path);
      const dir = full.replace(/\/[^/]+$/, '');
      require('node:fs').mkdirSync(dir, { recursive: true });
      writeFileSync(full, content);
    }
    return tmpDir;
  }

  function teardown() {
    if (tmpDir) rmSync(tmpDir, { recursive: true });
  }

  test('local reference exists -> pass', () => {
    const base = setup({
      'skill-a/SKILL.md': '---\nname: skill-a\n---\nSee `references/guide.md`',
      'skill-a/references/guide.md': '# Guide',
    });
    // Tests the local-exists early return (skillDir param controls local lookup)
    const result = checkCrossSkillRefPaths('skill-a', join(base, 'skill-a'), 'See `references/guide.md`');
    assert.equal(result.pass, true);
    teardown();
  });

  test('cross-skill path @skills/<parent>/references/ -> pass (skipped)', () => {
    const base = setup({
      'skill-a/SKILL.md': '---\nname: skill-a\n---\n',
      'skill-b/SKILL.md': '---\nname: skill-b\n---\nSee `@skills/skill-a/references/guide.md`',
      'skill-a/references/guide.md': '# Guide',
    });
    const result = checkCrossSkillRefPaths('skill-b', join(base, 'skill-b'), 'See `@skills/skill-a/references/guide.md`');
    assert.equal(result.pass, true);
    teardown();
  });

  test('bare reference not local and not in any other skill -> pass (not a cross-skill issue)', () => {
    const base = setup({
      'skill-a/SKILL.md': '---\nname: skill-a\n---\nSee `references/missing.md`',
    });
    // missing.md doesn't exist anywhere — that's a different check (references-routing), not cross-skill
    const result = checkCrossSkillRefPaths('skill-a', join(base, 'skill-a'), 'See `references/missing.md`');
    assert.equal(result.pass, true);
    teardown();
  });

  test('no references mentioned -> pass', () => {
    const result = checkCrossSkillRefPaths('skill-a', '/tmp/nonexistent', 'No refs here.');
    assert.equal(result.pass, true);
  });

  test('bare reference not local but exists in another skill -> P1', () => {
    // Uses the real module-global skillsDir (consistent with other check functions).
    // routing-signature-guide.md uniquely exists in skill-health-check/references/
    const fakeSkillDir = mkdtempSync(join(tmpdir(), 'fake-skill-'));
    const body = 'See `references/routing-signature-guide.md` for details';
    const result = checkCrossSkillRefPaths('fake-skill', fakeSkillDir, body);
    assert.equal(result.pass, false, 'should detect non-local reference found in another skill');
    assert.equal(result.severity, 'P1');
    assert.ok(result.message.includes('routing-signature-guide.md'));
    assert.ok(result.message.includes('skill-health-check'));
    rmSync(fakeSkillDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// detectInvalidAgentRefs
// ---------------------------------------------------------------------------

describe('detectInvalidAgentRefs', () => {
  const realAgentsDir = resolve(join(__dirname, '../../agents'));

  test('valid reference to existing agent -> no findings', () => {
    const skillResults = [{
      name: 'test-skill',
      body: 'Use Agent({ subagent_type: "strict-reviewer", prompt: "review" })',
    }];
    const findings = detectInvalidAgentRefs(skillResults, realAgentsDir);
    assert.equal(findings.length, 0);
  });

  test('built-in type Explore -> skip (no finding)', () => {
    const skillResults = [{
      name: 'deep-explore',
      body: 'Agent({ subagent_type: "Explore", prompt: "search" })',
    }];
    const findings = detectInvalidAgentRefs(skillResults, realAgentsDir);
    assert.equal(findings.length, 0);
  });

  test('built-in type general-purpose -> skip', () => {
    const skillResults = [{
      name: 'fallback-skill',
      body: 'subagent_type: "general-purpose"',
    }];
    const findings = detectInvalidAgentRefs(skillResults, realAgentsDir);
    assert.equal(findings.length, 0);
  });

  test('external plugin ref with colon -> skip', () => {
    const skillResults = [{
      name: 'review-skill',
      body: 'subagent_type: "pr-review-toolkit:code-reviewer"',
    }];
    const findings = detectInvalidAgentRefs(skillResults, realAgentsDir);
    assert.equal(findings.length, 0);
  });

  test('nonexistent agent -> P1 finding', () => {
    const skillResults = [{
      name: 'broken-skill',
      body: 'Agent({ subagent_type: "nonexistent-agent-xyz", prompt: "help" })',
    }];
    const findings = detectInvalidAgentRefs(skillResults, realAgentsDir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'P1');
    assert.ok(findings[0].message.includes('nonexistent-agent-xyz'));
  });

  test('multiple refs with one invalid -> 1 finding (valid skipped)', () => {
    const skillResults = [{
      name: 'multi-ref',
      body: 'subagent_type: "Explore"\nsubagent_type: "missing-bot"',
    }];
    const findings = detectInvalidAgentRefs(skillResults, realAgentsDir);
    assert.equal(findings.length, 1);
    assert.ok(findings[0].message.includes('missing-bot'));
  });

  test('unquoted subagent_type (markdown table text) -> skip by design', () => {
    const skillResults = [{
      name: 'table-skill',
      body: '| subagent_type: strict-reviewer | used in table |',
    }];
    const findings = detectInvalidAgentRefs(skillResults, realAgentsDir);
    assert.equal(findings.length, 0);
  });

  test('no subagent_type refs -> no findings', () => {
    const skillResults = [{
      name: 'simple-skill',
      body: 'This skill uses no agents at all.',
    }];
    const findings = detectInvalidAgentRefs(skillResults, realAgentsDir);
    assert.equal(findings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// detectAgentToolsSyntax
// ---------------------------------------------------------------------------

describe('detectAgentToolsSyntax', () => {
  let tmpDir;

  test('canonical bare tools -> no findings', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lint-test-'));
    writeFileSync(join(tmpDir, 'good-agent.md'), '---\nname: good-agent\ntools: Read, Grep, Glob, Bash\n---\n');
    const findings = detectAgentToolsSyntax(tmpDir);
    assert.equal(findings.length, 0);
    rmSync(tmpDir, { recursive: true });
  });

  test('canonical scoped Bash -> no findings', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lint-test-'));
    writeFileSync(join(tmpDir, 'scoped-agent.md'), '---\nname: scoped-agent\ntools: Read, Bash(git:*)\n---\n');
    const findings = detectAgentToolsSyntax(tmpDir);
    assert.equal(findings.length, 0);
    rmSync(tmpDir, { recursive: true });
  });

  test('non-canonical tool format flagged as P2', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lint-test-'));
    writeFileSync(join(tmpDir, 'bad-agent.md'), '---\nname: bad-agent\ntools: Read, Bash(codex *)\n---\n');
    const findings = detectAgentToolsSyntax(tmpDir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'P2');
    assert.ok(findings[0].message.includes('Bash(codex *)'));
    rmSync(tmpDir, { recursive: true });
  });

  test('empty tools field -> no findings', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lint-test-'));
    writeFileSync(join(tmpDir, 'empty-agent.md'), '---\nname: empty-agent\ntools: \n---\n');
    const findings = detectAgentToolsSyntax(tmpDir);
    assert.equal(findings.length, 0);
    rmSync(tmpDir, { recursive: true });
  });
});
