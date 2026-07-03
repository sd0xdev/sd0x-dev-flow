const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../skills/orchestrate/scripts/plan-context.js');
const tempDirs = [];

const CATALOG_BASE = `version: 1

categories:
  - id: planning
    label: Planning
    order: 1

skills:
  - command: /tech-spec
    category: planning
    featured: true
    use_when: "Writing technical specifications"
    public: true
  - command: /deep-explore
    category: planning
    featured: false
    public: true
  - command: /no-docs-skill
    category: planning
    featured: false
    public: true
`;

const ALLOWLIST = {
  version: 1,
  mode: 'deny-by-default',
  fanout_allowlist: [
    { name: 'Explore', type: 'builtin', rationale: 'harness excludes Edit/Write' },
    { name: 'reader-agent', type: 'repo-agent', expected_tools: 'Read, Grep, Glob', rationale: 'pure read' },
  ],
  explicit_exclusions: [],
};

function createFixtureRepo({ catalog = CATALOG_BASE, allowlist = ALLOWLIST, agentTools = 'Read, Grep, Glob' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-orch-ctx-'));
  tempDirs.push(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test.dev', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' }
  );
  mkdirSync(join(dir, 'docs', 'features', 'sample-feature'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'sample-feature', '2-tech-spec.md'), '# spec\n');
  writeFileSync(join(dir, 'docs', 'skill-catalog.yml'), catalog);
  mkdirSync(join(dir, 'skills', 'tech-spec'), { recursive: true });
  writeFileSync(
    join(dir, 'skills', 'tech-spec', 'SKILL.md'),
    '---\nname: tech-spec\ndescription: "Generate a tech spec document."\n---\n# Tech Spec\n'
  );
  mkdirSync(join(dir, 'skills', 'deep-explore'), { recursive: true });
  writeFileSync(
    join(dir, 'skills', 'deep-explore', 'SKILL.md'),
    '---\nname: deep-explore\ndescription: "Multi-wave parallel code exploration."\n---\n# Deep Explore\n'
  );
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(
    join(dir, 'agents', 'reader-agent.md'),
    `---\nname: reader-agent\ntools: ${agentTools}\n---\nReads things.\n`
  );
  writeFileSync(
    join(dir, 'agents', 'mutator-agent.md'),
    '---\nname: mutator-agent\ntools: Read, Edit, Write\n---\nMutates things.\n'
  );
  if (allowlist) writeFileSync(join(dir, 'allowlist.json'), JSON.stringify(allowlist, null, 2));
  return dir;
}

function runPlanContext(dir, extraArgs = []) {
  const args = [
    scriptPath,
    '--repo', dir,
    '--catalog', join(dir, 'docs', 'skill-catalog.yml'),
    '--skills-dir', join(dir, 'skills'),
    '--agents-dir', join(dir, 'agents'),
    '--allowlist', join(dir, 'allowlist.json'),
    ...extraArgs,
  ];
  try {
    const stdout = execFileSync('node', args, { encoding: 'utf8' });
    return { output: JSON.parse(stdout), exitCode: 0 };
  } catch (err) {
    return { output: null, exitCode: err.status, stderr: (err.stderr || '').toString() };
  }
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test('plan-context: new catalog entry is automatically included as a candidate (SC-5)', () => {
  const dir = createFixtureRepo({
    catalog: `${CATALOG_BASE}  - command: /dummy-new-skill\n    category: planning\n    featured: false\n    public: true\n`,
  });
  const { output, exitCode } = runPlanContext(dir);
  assert.equal(exitCode, 0);
  const commands = output.skill_candidates.map((s) => s.command);
  assert.ok(commands.includes('/dummy-new-skill'), 'new entry must appear without orchestrator changes');
  assert.equal(output.admission.mode, 'deny-by-default');
});

test('plan-context: use_when missing → SKILL.md frontmatter description fallback populated', () => {
  const dir = createFixtureRepo();
  const { output, exitCode } = runPlanContext(dir);
  assert.equal(exitCode, 0);
  const techSpec = output.skill_candidates.find((s) => s.command === '/tech-spec');
  assert.equal(techSpec.use_when, 'Writing technical specifications', 'explicit use_when wins');
  assert.equal(techSpec.description, 'Generate a tech spec document.');
  const deepExplore = output.skill_candidates.find((s) => s.command === '/deep-explore');
  assert.equal(deepExplore.use_when, 'Multi-wave parallel code exploration.', 'T1 fallback to description');
  const noDocs = output.skill_candidates.find((s) => s.command === '/no-docs-skill');
  assert.equal(noDocs.use_when, null, 'no use_when and no SKILL.md → null');
});

test('plan-context: malformed catalog line → exit 1 (strict parse, no silent drop)', () => {
  const dir = createFixtureRepo({
    catalog: `${CATALOG_BASE}  - command: /broken-entry\n    this line has no colon separator\n`,
  });
  const { exitCode, stderr } = runPlanContext(dir);
  assert.equal(exitCode, 1);
  assert.match(stderr, /unparseable/);
});

test('plan-context: skill referencing unknown category → exit 1', () => {
  const dir = createFixtureRepo({
    catalog: `${CATALOG_BASE}  - command: /lost-skill\n    category: nonexistent-category\n    featured: false\n    public: true\n`,
  });
  const { exitCode, stderr } = runPlanContext(dir);
  assert.equal(exitCode, 1);
  assert.match(stderr, /unknown category/);
});

test('plan-context: agent file without frontmatter → exit 1 (untrusted tool declaration)', () => {
  const dir = createFixtureRepo();
  writeFileSync(join(dir, 'agents', 'rogue-agent.md'), '# Rogue Agent\ntools: Read, Edit\n');
  const { exitCode, stderr } = runPlanContext(dir);
  assert.equal(exitCode, 1);
  assert.match(stderr, /missing frontmatter/);
});

test('plan-context: non-allowlisted agent carries deny_reason; allowlisted ones are eligible', () => {
  const dir = createFixtureRepo();
  const { output } = runPlanContext(dir);
  const mutator = output.agent_candidates.find((a) => a.name === 'mutator-agent');
  assert.equal(mutator.fanout_eligible, false);
  assert.match(mutator.deny_reason, /deny-by-default/);
  const reader = output.agent_candidates.find((a) => a.name === 'reader-agent');
  assert.equal(reader.fanout_eligible, true);
  const explore = output.agent_candidates.find((a) => a.name === 'Explore');
  assert.equal(explore.fanout_eligible, true);
});

test('plan-context: missing allowlist file → exit 1 (single fail-closed contract)', () => {
  const dir = createFixtureRepo({ allowlist: null });
  const { exitCode, stderr } = runPlanContext(dir);
  assert.equal(exitCode, 1);
  assert.match(stderr, /allowlist missing/);
});

test('plan-context: allowlist expected_tools drift vs agent frontmatter → exit 1', () => {
  const dir = createFixtureRepo({ agentTools: 'Read, Grep, Glob, Bash(git:*)' });
  const { exitCode, stderr } = runPlanContext(dir);
  assert.equal(exitCode, 1);
  assert.match(stderr, /allowlist drift/);
});

test('plan-context: missing catalog → exit 1; zero-entry catalog → exit 1', () => {
  const dir = createFixtureRepo();
  rmSync(join(dir, 'docs', 'skill-catalog.yml'));
  const missing = runPlanContext(dir);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /catalog missing/);
  writeFileSync(join(dir, 'docs', 'skill-catalog.yml'), 'version: 1\n\nskills:\n');
  const empty = runPlanContext(dir);
  assert.equal(empty.exitCode, 1);
  assert.match(empty.stderr, /zero skill entries/);
});

test('plan-context: budget tiers set caps and repo signals include features', () => {
  const dir = createFixtureRepo();
  const small = runPlanContext(dir, ['--budget', 'S']);
  assert.equal(small.output.budget.max_workers, 2);
  assert.equal(small.output.budget.max_plan_steps, 8);
  const large = runPlanContext(dir, ['--budget', 'L']);
  assert.equal(large.output.budget.max_waves, 3);
  const feature = large.output.repo_signals.features.find((f) => f.feature === 'sample-feature');
  assert.deepEqual(feature.lifecycle_docs, ['2-tech-spec.md']);
});

test('plan-context: invalid --budget → exit 1', () => {
  const dir = createFixtureRepo();
  const { exitCode, stderr } = runPlanContext(dir, ['--budget', 'XL']);
  assert.equal(exitCode, 1);
  assert.match(stderr, /invalid --budget/);
});

test('plan-context: assembled context exceeding tier max_context_bytes → exit 1 (no silent truncation)', () => {
  let bulkCatalog = CATALOG_BASE;
  const longUseWhen = 'when the planner needs an unusually verbose routing hint '.repeat(8).trim();
  for (let i = 0; i < 200; i += 1) {
    bulkCatalog += `  - command: /bulk-skill-${i}\n    category: planning\n    featured: false\n    public: true\n    use_when: "${longUseWhen}"\n`;
  }
  const dir = createFixtureRepo({ catalog: bulkCatalog });
  const { exitCode, stderr } = runPlanContext(dir, ['--budget', 'S']);
  assert.equal(exitCode, 1);
  assert.match(stderr, /exceeds tier S cap/);
  assert.match(stderr, /raise --budget or narrow scope/, 'overage message must point to remediation');
});

test('plan-context: missing agents dir → exit 1 (fail-closed, no partial candidates)', () => {
  const dir = createFixtureRepo();
  rmSync(join(dir, 'agents'), { recursive: true });
  const { exitCode, stderr } = runPlanContext(dir);
  assert.equal(exitCode, 1);
  assert.match(stderr, /agents dir unreadable/);
});

test('plan-context: malformed allowlist JSON → exit 1 (parse failure is not a pass)', () => {
  const dir = createFixtureRepo();
  writeFileSync(join(dir, 'allowlist.json'), '{ "mode": "deny-by-default", fanout_allowlist: [ }');
  const { exitCode, stderr } = runPlanContext(dir);
  assert.equal(exitCode, 1);
  assert.match(stderr, /allowlist is not valid JSON/);
});
