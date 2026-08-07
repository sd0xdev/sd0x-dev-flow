'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const AGENT_DIR = resolve(__dirname, '../../agents');

/**
 * Frontmatter is a block of `key: value` lines between the first two `---` fences. Parsed
 * rather than grepped so a key appearing in the agent's BODY — several agents quote
 * `model:` inside an example — cannot satisfy an assertion about its declaration.
 */
const frontmatter = (file) => {
  const src = readFileSync(resolve(AGENT_DIR, file), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  assert.ok(m, `${file}: no frontmatter block`);
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
};

const agents = readdirSync(AGENT_DIR).filter((f) => f.endsWith('.md')).sort();

test('A1: every agent declares the project default model and effort', () => {
  // rules/auto-loop.md § Review Dispatch states the default; this is what keeps the file and
  // the rule from drifting apart. Reviewing is the workload that pays for depth, and an agent
  // that quietly ran at a lower tier would still emit a report that reads like a real review.
  assert.ok(agents.length >= 15, `expected the agent set, found ${agents.length}`);
  for (const file of agents) {
    const fm = frontmatter(file);
    assert.equal(fm.model, 'opus', `${file}: model must be the project default`);
    assert.equal(fm.effort, 'high', `${file}: effort must be the project default`);
  }
});

test('A1b: the reviewers the fallback path names are among them', () => {
  // Named explicitly because these three are what a user reaches for when Codex is
  // unavailable — the case the rule is written for. A rename that dropped one would
  // otherwise leave A1 green over a set that no longer contains it.
  for (const file of ['strict-reviewer.md', 'tech-spec-reviewer.md', 'refactor-reviewer.md']) {
    assert.ok(agents.includes(file), `${file} must exist for the fallback path to name it`);
    const fm = frontmatter(file);
    assert.equal(fm.model, 'opus', `${file}: model`);
    assert.equal(fm.effort, 'high', `${file}: effort`);
  }
});

test('A1c: the parser reads declarations, not the agent body', () => {
  // Negative control for A1's parser: without it, an agent whose PROSE contains a line
  // reading `model: sonnet` could satisfy — or break — the assertions above for a reason
  // that has nothing to do with what it declares.
  const fake = '---\nname: x\nmodel: opus\neffort: high\n---\n\nExample: `model: sonnet`\n';
  const m = /^---\n([\s\S]*?)\n---\n/.exec(fake);
  const keys = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) keys[kv[1]] = kv[2].trim();
  }
  assert.equal(keys.model, 'opus', 'the body mention must not win over the declaration');
  assert.ok(!m[1].includes('sonnet'), 'and must not be inside the frontmatter slice at all');
});

test('A1d: rules/auto-loop.md states the same default this test enforces', () => {
  // A test and a rule that disagree is worse than either alone: the rule is what a model
  // reads, the test is what fails. Both directions are asserted so neither can drift alone.
  const rule = readFileSync(resolve(__dirname, '../../rules/auto-loop.md'), 'utf8');
  assert.match(rule, /`model: opus` and `effort: high`/,
    'rules/auto-loop.md § Review Dispatch must state the agent default verbatim');
  assert.match(rule, /test\/agents\/frontmatter\.test\.js/,
    'and must name this file as what pins it');
  // Negative control: the search must be able to fail.
  assert.doesNotMatch(rule, /`model: haiku` and `effort: high`/,
    'control: a default the project does not set must not be found');
});
