'use strict';
// Every `Bash(...)` and `mcp__*` grant in a skill's frontmatter is a permission the dispatcher
// hands the model whenever that skill loads. A grant nothing in the skill runs is surface with no
// user — the class INV-007 exists to keep bounded.
// Contract: docs/features/codex-exec-transport/requests/2026-09-03-permission-readme-and-catalog-sweep.md.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const SKILLS = join(ROOT, 'skills');

// ---------------------------------------------------------------------------
// What counts as evidence that a skill runs a command
// ---------------------------------------------------------------------------
// Prose is not evidence: "reads git history" mentions git and runs nothing. Only CODE is —
// fenced blocks and inline code spans in the skill's markdown, and the whole text of any script
// it ships. Grepping the raw markdown instead would pass every skill that merely names a tool.
const codeOf = (file) => {
  const text = readFileSync(file, 'utf8');
  if (/\.(sh|js|py)$/.test(file)) return text;
  if (!/\.md$/.test(file)) return '';
  let out = '';
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) out += '\n' + m[1];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) out += '\n' + m[1];
  return out;
};

const filesUnder = (dir) => {
  const out = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  })(dir);
  return out;
};

// One hop, and the hop is load-bearing rather than generosity: INV-001 puts the transport command
// line in exactly one file, so a Codex dispatcher's `node <locator>` lives in
// `skills/codex-code-review/references/codex-transport.md` and in no other skill's directory.
// Without the hop, following the one-authority rule would itself read as an unjustified grant.
// Bounded to repo paths the skill names explicitly; a cited file's own citations are not followed.
const CITATION = /(?:@)?((?:skills|rules|scripts|hooks)\/[A-Za-z0-9_./-]+\.(?:md|js|sh))/g;

const corpusOf = (dir) => {
  let text = '';
  const cited = new Set();
  for (const f of filesUnder(dir)) {
    text += '\n' + codeOf(f);
    if (/\.md$/.test(f)) {
      for (const m of readFileSync(f, 'utf8').matchAll(CITATION)) cited.add(m[1]);
    }
  }
  for (const c of cited) {
    const p = join(ROOT, c);
    if (existsSync(p) && statSync(p).isFile()) text += '\n' + codeOf(p);
  }
  return text;
};

const frontmatterOf = (skillFile) => {
  const m = readFileSync(skillFile, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : '';
};

const grantsIn = (frontmatter) => {
  const m = frontmatter.match(/^allowed-tools:\s*(.+)$/m);
  if (!m) return { bash: [], mcp: [] };
  const items = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  return {
    bash: items.filter((t) => /^Bash\(.*\)$/.test(t)).map((t) => t.slice(5, -1).replace(/:\*$/, '')),
    mcp: items.filter((t) => /^mcp__/.test(t)),
  };
};

// The spec is matched at a command position — not anywhere in the text. `git` must not be
// satisfied by `github`, nor by the `git` inside `.gitignore`; `python*` is a glob in the grant
// and stays one here. A trailing `-` is excluded too, so `git` does not match `git-only`.
const runs = (spec, corpus) => {
  const escaped = spec
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '[A-Za-z0-9_.-]*');
  return new RegExp(`(?<![A-Za-z0-9_./-])${escaped}(?![A-Za-z0-9_-])`).test(corpus);
};

const skillNames = readdirSync(SKILLS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(SKILLS, e.name, 'SKILL.md')))
  .map((e) => e.name)
  .sort();

const unjustifiedGrants = (name, { frontmatter, corpus } = {}) => {
  const dir = join(SKILLS, name);
  const fm = frontmatter !== undefined ? frontmatter : frontmatterOf(join(dir, 'SKILL.md'));
  const body = corpus !== undefined ? corpus : corpusOf(dir);
  const { bash } = grantsIn(fm);
  return bash.filter((g) => !runs(g, body)).map((g) => `${name}: ${g}`);
};

// ---------------------------------------------------------------------------
// The residual, pinned by equality
// ---------------------------------------------------------------------------
// Measured 2026-09-04 by this file's own check — `KNOWN_UNJUSTIFIED.length` is the number, and
// the distinct skill count is the number of unique prefixes before `:` — 49 Bash grants across 22
// skills that no code in their own directory, or in a file they cite, invokes. They are pre-existing and outside this feature's reach — the migration's own
// grants are fixed rather than listed (`Bash(codex:*)` is gone from every skill; the transport
// dispatchers run `node <locator>`, which the hop above resolves). Deferred to
// `requests/2026-09-04-frontmatter-grant-surface-burndown.md`.
//
// Equality, not containment, is what keeps this honest in both directions: a NEW unjustified grant
// fails because it is not on the list, and a CLEANED one fails because the list still claims it —
// so the inventory can only shrink deliberately, never rot into a blanket exemption.
const KNOWN_UNJUSTIFIED = [
  'check-coverage: find',
  'check-coverage: ls',
  'check-coverage: wc',
  'claude-health: rm',
  'code-explore: ls',
  'codex-brainstorm: find',
  'codex-review: npm',
  'codex-review: yarn',
  'codex-setup: ls',
  'deep-analyze: git',
  'deep-analyze: node',
  'install-hooks: chmod',
  'install-hooks: diff',
  'install-hooks: jq',
  'install-hooks: ls',
  'install-hooks: mkdir',
  'install-rules: diff',
  'install-rules: git',
  'install-rules: ls',
  'install-rules: mkdir',
  'install-scripts: chmod',
  'install-scripts: cp',
  'install-scripts: diff',
  'install-scripts: ls',
  'install-scripts: mkdir',
  'orchestrate: git check-ignore',
  'orchestrate: git log',
  'pr-review: git',
  'pr-summary: git',
  'pre-pr-audit: bash',
  'precommit: mypy',
  'precommit: npx',
  'precommit: pnpm',
  'precommit-fast: mypy',
  'precommit-fast: npx',
  'precommit-fast: pnpm',
  'project-setup: ls',
  'remind: cat',
  'safe-remove: bash',
  'safe-remove: git',
  'simplify: TEST_ENV=unit npx jest',
  'test-health: find',
  'test-health: python*',
  'verify: bundle',
  'verify: mvn',
  'verify: npm',
  'verify: pnpm',
  'verify: python*',
  'verify: yarn',
];

describe('every Bash grant is justified by code the skill runs', () => {
  test('the unjustified set is exactly the pinned inventory', () => {
    const found = skillNames.flatMap((n) => unjustifiedGrants(n)).sort();
    assert.deepEqual(found, [...KNOWN_UNJUSTIFIED].sort(),
      'a grant nothing runs was added, or a listed one was cleaned without updating the inventory');
  });

  test('no skill grants Bash(codex:*) — the transport runs the adapter through node', () => {
    // The migration's own surface, fixed rather than listed. `codex exec` is typed by
    // `scripts/codex-exec.js`, never by a skill, so a skill holding this grant is holding the
    // pre-migration permission.
    const holders = skillNames.filter((n) =>
      grantsIn(frontmatterOf(join(SKILLS, n, 'SKILL.md'))).bash.includes('codex'));
    assert.deepEqual(holders, [], 'these skills still grant the pre-migration codex permission');
  });
});

describe('the justification check fails on a grant nothing runs', () => {
  // Negative control on the checker itself. Without it, a regex that matched everything would
  // report an empty set and the equality pin above would read as a clean repository.
  const VICTIM = 'precommit';

  test('a planted grant is reported', () => {
    const fm = frontmatterOf(join(SKILLS, VICTIM, 'SKILL.md'));
    const planted = fm.replace(/^(allowed-tools:.*)$/m, '$1, Bash(nosuchcommand:*)');
    assert.notEqual(planted, fm, 'the control must actually modify the frontmatter');
    const found = unjustifiedGrants(VICTIM, { frontmatter: planted });
    assert.ok(found.includes(`${VICTIM}: nosuchcommand`), 'the planted grant went unreported');
  });

  test('a grant the body does run is not reported', () => {
    // Positive control from the same skill, so the two differ only in whether the command is run.
    const fm = 'allowed-tools: Bash(cargo:*), Bash(nosuchcommand:*)';
    const found = unjustifiedGrants(VICTIM, { frontmatter: fm });
    assert.deepEqual(found, [`${VICTIM}: nosuchcommand`],
      'cargo is invoked in the ecosystem table and must not be reported');
  });

  test('prose naming a command is not evidence that the skill runs it', () => {
    // The distinction the whole checker rests on, exercised through codeOf itself: the same
    // command word, once as prose and once as a code span, in the same temporary document.
    const dir = mkdtempSync(join(tmpdir(), 'grants-'));
    try {
      const file = join(dir, 'SKILL.md');
      writeFileSync(file, 'This step inspects kubectl output before deciding.\n');
      assert.equal(runs('kubectl', codeOf(file)), false,
        'a prose mention must not justify a grant');
      writeFileSync(file, 'Then run `kubectl get pods` and read the result.\n');
      assert.equal(runs('kubectl', codeOf(file)), true,
        'positive control: the same word inside a code span is evidence');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a command name inside a longer word does not justify the grant', () => {
    assert.equal(runs('git', 'github clone'), false, 'github is not git');
    assert.equal(runs('git', 'git status'), true, 'positive control: the command itself');
    assert.equal(runs('node', 'scripts/node-helper.js'), false, 'a path segment is not a command');
    assert.equal(runs('python*', 'python3 -m pytest'), true, 'the grant glob still globs');
  });
});

// `jira` grants a tool for a feature its own SKILL.md defers ("Searching Jira issues → v1.1"),
// so the permission is live and the caller is not. Pre-existing and outside this feature's reach;
// same burndown ticket as the Bash residual, same equality pin.
const KNOWN_UNJUSTIFIED_MCP = ['jira: mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql'];

// A body calls these by method name — `createJiraIssue`, not the wire id — so the suffix after
// the last `__` counts as naming the tool. The suffix is distinctive enough to be evidence; the
// server prefix is boilerplate every grant repeats. Read over the whole skill directory, because
// a reference file is where a multi-step call sequence usually lives.
const unjustifiedMcp = (name) => {
  const file = join(SKILLS, name, 'SKILL.md');
  const { mcp } = grantsIn(frontmatterOf(file));
  if (mcp.length === 0) return [];
  const body = filesUnder(join(SKILLS, name))
    .map((f) => readFileSync(f, 'utf8').replace(/^---\n[\s\S]*?\n---/, ''))
    .join('\n');
  return mcp
    .filter((tool) => !body.includes(tool) && !body.includes(tool.split('__').pop()))
    .map((tool) => `${name}: ${tool}`);
};

describe('every MCP grant names a tool the skill body uses', () => {
  test('the unjustified MCP set is exactly the pinned inventory', () => {
    const found = skillNames.flatMap(unjustifiedMcp).sort();
    assert.deepEqual(found, [...KNOWN_UNJUSTIFIED_MCP].sort(),
      'an MCP grant nothing calls was added, or a listed one was cleaned without updating the inventory');
  });

  test('an MCP grant the body never names is caught, by id or by method', () => {
    const named = (body, tool) => body.includes(tool) || body.includes(tool.split('__').pop());
    const body = 'Step 3 calls createJiraIssue() with the collected fields.';
    assert.equal(named(body, 'mcp__claude_ai_Atlassian__createJiraIssue'), true,
      'positive control: the method name is how a body writes the call');
    assert.equal(named(body, 'mcp__claude_ai_Atlassian__deleteJiraIssue'), false,
      'a granted tool the body never calls is still reported');
  });
});
