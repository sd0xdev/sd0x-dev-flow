'use strict';

/**
 * skill-contract.test.js — pins the `allowed-tools` surface of `skills/best-practices/SKILL.md`
 * against Non-Negotiable Rule 2 ("Phase 3 must invoke /codex-brainstorm via Skill tool — raw
 * `mcp__codex__codex` debate is invalid").
 *
 * The frontmatter used to pre-approve `mcp__codex__codex` and `mcp__codex__codex-reply`, on the
 * stated grounds that "/codex-brainstorm uses them internally". That reasoning is wrong: a
 * sub-skill invoked through the Skill tool carries its OWN allowed-tools, so the parent grant was
 * never required for the inheritance — it only handed the model the exact call Rule 2 forbids.
 *
 * ⚠️ WHAT THESE TESTS DO AND DO NOT PROVE. They assert the declared permission SURFACE, nothing
 * more. `allowed-tools` is a PRE-APPROVAL list, not a deny list (`skills/orchestrate/SKILL.md`),
 * so an omitted tool stays reachable through the normal permission flow — no assertion here
 * demonstrates runtime denial, and none is claimed. What they pin is that the call Rule 2 forbids
 * is not silently pre-authorized. That is worth a test precisely BECAUSE nothing else catches it:
 * a re-added frontmatter entry would widen the surface invisibly while the prose rule still read
 * as enforced.
 *
 * (An earlier draft of this docstring cited `/necessity-audit` as a skill that "lists neither".
 * That was false — its frontmatter declares `mcp__codex__codex-reply` and it uses the tool
 * directly for the Phase C `--continue` loop. The two skills differ deliberately: only
 * best-practices routes its entire Codex conversation through the sub-skill.)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS_DIR = path.join(__dirname, '..', '..', '..', 'skills');
const SKILL_PATH = path.join(SKILLS_DIR, 'best-practices', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8');

function allowedTools(md) {
  const m = md.match(/^allowed-tools:\s*(.+)$/m);
  assert.ok(m, 'SKILL.md must declare allowed-tools in frontmatter');
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

test('best-practices allowed-tools omits raw Codex MCP tools → Rule 2 is structural', () => {
  const tools = allowedTools(skill);
  assert.ok(
    !tools.includes('mcp__codex__codex'),
    'mcp__codex__codex must NOT be pre-approved — Rule 2 declares a raw MCP debate invalid, so granting the tool contradicts the rule it is meant to enforce'
  );
  assert.ok(
    !tools.includes('mcp__codex__codex-reply'),
    'mcp__codex__codex-reply must NOT be pre-approved — this skill makes no direct reply call; /codex-brainstorm owns the whole MCP conversation'
  );
});

test('best-practices allowed-tools retains Skill → the debate still has a route', () => {
  const tools = allowedTools(skill);
  assert.ok(
    tools.includes('Skill'),
    'Skill must stay granted — removing the MCP tools is only safe because Phase 3 reaches Codex through /codex-brainstorm'
  );
});

test('best-practices makes no direct Codex MCP call anywhere in its own assets', () => {
  const dir = path.join(SKILLS_DIR, 'best-practices');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) files.push(p);
    }
  })(dir);

  // Prose that NAMES the tool in order to forbid it is the point of the rule, so an unfiltered
  // grep would flag the enforcement text itself. Only fenced code blocks are executable surface.
  const offenders = [];
  for (const f of files) {
    const body = fs.readFileSync(f, 'utf8');
    for (const m of body.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
      if (/mcp__codex__codex/.test(m[1])) offenders.push(path.relative(dir, f));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `no executable block may invoke Codex MCP directly; found in: ${offenders.join(', ')}`
  );
});

test('the /codex-brainstorm sub-skill still declares the MCP tools it needs', () => {
  // Pins the assumption the removal rests on. If codex-brainstorm ever drops these, the parent
  // removal becomes a real break rather than a tightening — this test goes red first.
  const brainstorm = fs.readFileSync(path.join(SKILLS_DIR, 'codex-brainstorm', 'SKILL.md'), 'utf8');
  const tools = allowedTools(brainstorm);
  assert.ok(tools.includes('mcp__codex__codex'), '/codex-brainstorm must own mcp__codex__codex');
  assert.ok(tools.includes('mcp__codex__codex-reply'), '/codex-brainstorm must own mcp__codex__codex-reply');
});
