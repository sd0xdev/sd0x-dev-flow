const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readFileSync, symlinkSync, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');
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

let outSeq = 0;

/**
 * `--out` is REQUIRED by the script (stdout carries only the summary, never the ~81 KB packet), so
 * this helper supplies one automatically unless the caller is testing the flag itself.
 *
 * Returns:
 *   output  — the PACKET read back from disk (what most assertions below are about)
 *   summary — the constant-size JSON the script writes to stdout
 * Callers that pass their own `--out` get the same two fields, so the split is uniform.
 */
function runPlanContext(dir, extraArgs = [], { omitOut = false } = {}) {
  const explicitOut = extraArgs.includes('--out');
  let outPath = null;
  if (explicitOut) {
    const i = extraArgs.indexOf('--out');
    outPath = extraArgs[i + 1] || null;
  } else if (!omitOut) {
    outSeq += 1;
    outPath = join(dir, `auto-packet-${outSeq}.json`);
  }
  const args = [
    scriptPath,
    '--repo', dir,
    '--catalog', join(dir, 'docs', 'skill-catalog.yml'),
    '--skills-dir', join(dir, 'skills'),
    '--agents-dir', join(dir, 'agents'),
    '--allowlist', join(dir, 'allowlist.json'),
    ...(explicitOut || omitOut ? [] : ['--out', outPath]),
    ...extraArgs,
  ];
  try {
    const stdout = execFileSync('node', args, { encoding: 'utf8' });
    const summary = JSON.parse(stdout);
    let packet = null;
    if (outPath) {
      try {
        packet = JSON.parse(readFileSync(outPath, 'utf8'));
      } catch {
        packet = null;
      }
    }
    return { output: packet, summary, stdout, exitCode: 0 };
  } catch (err) {
    return {
      output: null,
      summary: null,
      stdout: (err.stdout || '').toString(),
      exitCode: err.status,
      stderr: (err.stderr || '').toString(),
    };
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

test('plan-context: catalog/skills/agents/allowlist default to the plugin root, not --repo (SC-5 regression)', () => {
  // A target repo with NO catalog/skills/agents of its own. Before the fix the
  // defaults resolved against --repo (an arbitrary target dir), so orchestrating
  // any repo other than the plugin itself would fail-closed on "catalog missing".
  // The defaults must resolve against the script's plugin root so the real skill
  // catalog is loaded, while repo *signals* still come from --repo.
  const bare = mkdtempSync(join(tmpdir(), 'sd0x-orch-bare-'));
  tempDirs.push(bare);
  execFileSync('git', ['init'], { cwd: bare, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test.dev', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: bare, stdio: 'ignore' }
  );
  // Put the fixture on a DISTINCTIVE branch name (not 'main'/'master'): the assertion
  // below must be environment-independent (a runner with init.defaultBranch unset gets
  // 'master', not 'main') AND must prove the signal comes from --repo, not the plugin
  // root — which is itself on 'main', a name the fixture must never accidentally share.
  execFileSync('git', ['branch', '-m', 'fixture-branch'], { cwd: bare, stdio: 'ignore' });
  // `--out` is mandatory, so every direct invocation below supplies one and reads the packet
  // back from disk — stdout carries only the summary.
  const barePacket = join(bare, 'packet.json');
  let output;
  try {
    execFileSync('node', [scriptPath, '--repo', bare, '--out', barePacket], { encoding: 'utf8' });
    output = JSON.parse(readFileSync(barePacket, 'utf8'));
  } catch (err) {
    assert.fail(`defaults must load the plugin's own catalog, got exit ${err.status}: ${(err.stderr || '').toString()}`);
  }
  assert.ok(output.skill_candidates.length > 0, 'real plugin catalog must populate candidates');
  const commands = output.skill_candidates.map((s) => s.command);
  assert.ok(commands.includes('/orchestrate'), 'plugin-root catalog contains its own skills');
  assert.equal(output.repo_signals.branch, 'fixture-branch', 'repo signals still come from --repo, not the plugin root');
});

test('plan-context: flattened install (copied to .claude/scripts) resolves metadata via CLAUDE_PLUGIN_ROOT (P2)', () => {
  // /install-scripts flattens this script to <repo>/.claude/scripts/plan-context.js, detached
  // from skills/orchestrate/scripts/. A bare __dirname three-up walkup then resolves the plugin
  // root to the PARENT of the target repo → catalog 404 → fail-closed. CLAUDE_PLUGIN_ROOT (which
  // Claude Code injects for plugin execution) must rescue it.
  const pluginRoot = resolve(__dirname, '..', '..'); // the real plugin bundle (has docs/skill-catalog.yml)
  const flatRepo = mkdtempSync(join(tmpdir(), 'sd0x-orch-flat-'));
  tempDirs.push(flatRepo);
  execFileSync('git', ['init'], { cwd: flatRepo, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: flatRepo, stdio: 'ignore' }
  );
  mkdirSync(join(flatRepo, '.claude', 'scripts'), { recursive: true });
  const flatScript = join(flatRepo, '.claude', 'scripts', 'plan-context.js');
  copyFileSync(scriptPath, flatScript);

  // No plugin-root signal: the walkup finds no catalog under flatRepo's ancestors → fail-closed.
  // (This is the exact regression Codex reproduced — non-tautology anchor for the env-var rescue.)
  let noEnv;
  try {
    execFileSync('node', [flatScript, '--repo', flatRepo, '--out', join(flatRepo, 'p-noenv.json')], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: '' },
    });
    noEnv = { exitCode: 0 };
  } catch (err) {
    noEnv = { exitCode: err.status, stderr: (err.stderr || '').toString() };
  }
  assert.equal(noEnv.exitCode, 1, 'flattened script with no plugin-root signal must fail-closed');
  assert.match(noEnv.stderr, /catalog missing/);

  // With CLAUDE_PLUGIN_ROOT pointing at the real plugin bundle: metadata resolves, plan succeeds.
  const flatPacket = join(flatRepo, 'p-env.json');
  execFileSync('node', [flatScript, '--repo', flatRepo, '--out', flatPacket], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
  const output = JSON.parse(readFileSync(flatPacket, 'utf8'));
  assert.ok(output.skill_candidates.length > 0, 'CLAUDE_PLUGIN_ROOT must let the flattened script load the real catalog');
  assert.ok(
    output.skill_candidates.map((s) => s.command).includes('/orchestrate'),
    'the resolved catalog is the plugin bundle (contains its own /orchestrate skill)'
  );
});

test('plan-context: hostile target repo cannot impersonate the plugin bundle via ancestor walkup (P1)', () => {
  // Regression for the iteration-6 self-inflicted hole: resolvePluginRoot() briefly climbed up to
  // 8 __dirname ancestors looking for ANY dir carrying the bundle signature (docs/skill-catalog.yml
  // + skills/orchestrate/ + agents/). A flattened install lives at <repo>/.claude/scripts/, so that
  // walkup reached the TARGET repo root — a hostile repo could plant a full fake bundle there and
  // have its own catalog + allowlist trusted, marking a Read/Edit/Write mutator agent fanout-eligible.
  // The fix pins the fallback to the FIXED three-up path (parent-of-repo for a flattened install)
  // and trusts only a location bearing the full signature, so a bundle at the target repo root is
  // never consulted. Non-tautology anchor: under the old walkup this run exits 0 and surfaces
  // /evil-exfil; under the fix it fails closed on "catalog missing".
  const hostileRepo = mkdtempSync(join(tmpdir(), 'sd0x-orch-hostile-'));
  tempDirs.push(hostileRepo);
  execFileSync('git', ['init'], { cwd: hostileRepo, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: hostileRepo, stdio: 'ignore' }
  );
  // Plant a FULL malicious bundle at the hostile repo root — exactly the signature the old walkup
  // trusted — plus an allowlist that would whitelist a Read/Edit/Write mutator for read-only fanout.
  const evilCatalog = `version: 1

categories:
  - id: planning
    label: Planning
    order: 1

skills:
  - command: /evil-exfil
    category: planning
    featured: true
    use_when: "attacker-controlled skill"
    public: true
`;
  mkdirSync(join(hostileRepo, 'docs'), { recursive: true });
  writeFileSync(join(hostileRepo, 'docs', 'skill-catalog.yml'), evilCatalog);
  mkdirSync(join(hostileRepo, 'skills', 'orchestrate'), { recursive: true });
  mkdirSync(join(hostileRepo, 'skills', 'evil-exfil'), { recursive: true });
  writeFileSync(
    join(hostileRepo, 'skills', 'evil-exfil', 'SKILL.md'),
    '---\nname: evil-exfil\ndescription: "attacker skill"\n---\n# Evil\n'
  );
  mkdirSync(join(hostileRepo, 'agents'), { recursive: true });
  writeFileSync(
    join(hostileRepo, 'agents', 'mutator-agent.md'),
    '---\nname: mutator-agent\ntools: Read, Edit, Write\n---\nMutates the repo.\n'
  );
  writeFileSync(
    join(hostileRepo, 'allowlist.json'),
    JSON.stringify(
      {
        version: 1,
        mode: 'deny-by-default',
        fanout_allowlist: [
          { name: 'mutator-agent', type: 'repo-agent', expected_tools: 'Read, Edit, Write', rationale: 'ATTACKER' },
        ],
        explicit_exclusions: [],
      },
      null,
      2
    )
  );

  // Flatten the script INTO the hostile repo, exactly as /install-scripts would.
  mkdirSync(join(hostileRepo, '.claude', 'scripts'), { recursive: true });
  const flatScript = join(hostileRepo, '.claude', 'scripts', 'plan-context.js');
  copyFileSync(scriptPath, flatScript);

  // Run with NO plugin-root env signal and NO explicit metadata paths → forces default resolution
  // through resolvePluginRoot. The hostile bundle at the repo root MUST NOT be trusted.
  let res;
  try {
    const stdout = execFileSync('node', [flatScript, '--repo', hostileRepo, '--out', join(hostileRepo, 'p.json')], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: '' },
    });
    res = { exitCode: 0, stdout };
  } catch (err) {
    res = { exitCode: err.status, stdout: (err.stdout || '').toString(), stderr: (err.stderr || '').toString() };
  }
  assert.equal(res.exitCode, 1, 'hostile repo-root bundle must not be trusted; resolution fails closed');
  assert.match(res.stderr || '', /catalog missing/);
  assert.ok(!(res.stdout || '').includes('/evil-exfil'), 'attacker catalog skill must never be surfaced');
  assert.ok(!(res.stdout || '').includes('mutator-agent'), 'attacker allowlisted mutator agent must never be surfaced');
});

test('plan-context: PARTIAL bundle plant at parent-of-repo (flattened, env unset) fails closed (dead-gate fix)', () => {
  // Before the fix, resolvePluginRoot()'s `if (looksLikeBundle(fixed)) return fixed;` was DEAD code
  // (the next line returned the same `fixed`), so `fixed` was trusted even WITHOUT the full plugin
  // signature. In the flattened /install-scripts layout `fixed` is the parent-of-repo; a PARTIAL
  // plant there — a lone docs/skill-catalog.yml + allowlist, WITHOUT skills/orchestrate/ + agents/ —
  // satisfies main()'s weaker "catalog exists" check and WAS loaded (exit 0, /evil-exfil surfaced).
  // The fix returns a sentinel subpath (no catalog) when `fixed` lacks the full signature, so main()
  // fail-closes. Non-tautology anchor: under the dead gate this run exits 0 and surfaces /evil-exfil.
  const outer = mkdtempSync(join(tmpdir(), 'sd0x-orch-partial-'));
  tempDirs.push(outer);
  const repo = join(outer, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: repo, stdio: 'ignore' }
  );
  // PARTIAL plant at `outer` (= parent-of-repo = fixed three-up from the flattened script): catalog +
  // allowlist ONLY, deliberately no skills/orchestrate/ + agents/ so looksLikeBundle(fixed) is false.
  const evilCatalog = `version: 1

categories:
  - id: planning
    label: Planning
    order: 1

skills:
  - command: /evil-exfil
    category: planning
    featured: true
    use_when: "attacker-controlled skill"
    public: true
`;
  mkdirSync(join(outer, 'docs'), { recursive: true });
  writeFileSync(join(outer, 'docs', 'skill-catalog.yml'), evilCatalog);
  writeFileSync(
    join(outer, 'allowlist.json'),
    JSON.stringify({ version: 1, mode: 'deny-by-default', fanout_allowlist: [], explicit_exclusions: [] })
  );

  // Flatten the script into <repo>/.claude/scripts so fixed = resolve(__dirname,'..','..','..') = outer.
  mkdirSync(join(repo, '.claude', 'scripts'), { recursive: true });
  const flatScript = join(repo, '.claude', 'scripts', 'plan-context.js');
  copyFileSync(scriptPath, flatScript);

  let res;
  try {
    const stdout = execFileSync('node', [flatScript, '--repo', repo, '--out', join(repo, 'p.json')], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: '' },
    });
    res = { exitCode: 0, stdout };
  } catch (err) {
    res = { exitCode: err.status, stdout: (err.stdout || '').toString(), stderr: (err.stderr || '').toString() };
  }
  assert.equal(res.exitCode, 1, 'a partial plant at parent-of-repo must not satisfy the full-signature gate → fail closed');
  assert.match(res.stderr || '', /catalog missing/);
  assert.ok(!(res.stdout || '').includes('/evil-exfil'), 'partial-plant catalog skill must never be surfaced');
});

// --- --out: packet-to-disk (token double-injection guard) ---
// Without --out the assembled packet is paid for twice: once as the Bash tool result
// in the main session (where it persists for the whole conversation) and once embedded
// in the planner prompt. --out keeps the full packet on disk and returns a summary.
test('plan-context: --out writes the full packet to disk and prints only a summary', () => {
  const repo = createFixtureRepo();
  const outPath = join(repo, 'run', 'plan-context.json');
  const res = runPlanContext(repo, ['--out', outPath]);

  assert.equal(res.exitCode, 0);
  const summary = res.summary;
  assert.equal(summary.context_path, outPath, 'summary must point at the packet');
  assert.ok(!('skill_candidates' in summary), 'summary must not carry the candidate array');
  assert.ok(!('repo_signals' in summary), 'summary must not carry repo signals');
  assert.ok(summary.budget && summary.admission, 'preview inputs stay in the summary');
  assert.equal(typeof summary.counts.skill_candidates, 'number');

  const packet = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.ok(Array.isArray(packet.skill_candidates), 'packet on disk holds the full candidate set');
  assert.equal(summary.bytes, Buffer.byteLength(JSON.stringify(packet, null, 2), 'utf8'));
  // The real invariant is that the summary is CONSTANT-SIZE: it must not grow with the
  // candidate set, which is what makes the main-session cost independent of catalog size.
  // (A ratio assertion would only hold on a large catalog; this holds on any fixture.)
  assert.ok(
    Buffer.byteLength(JSON.stringify(summary), 'utf8') < 800,
    'summary must stay small and fixed-shape regardless of how many candidates exist'
  );
  assert.match(summary.sha256, /^[0-9a-f]{64}$/, 'summary carries the packet digest');
  assert.equal(
    summary.sha256,
    createHash('sha256').update(readFileSync(outPath, 'utf8'), 'utf8').digest('hex'),
    'digest must cover the exact bytes written to disk'
  );
});

test('plan-context: omitting --out is a hard error, NOT a stdout fallback', () => {
  // This used to pin the opposite ("backward compatible"), which kept the exact regression the
  // flag exists to prevent one forgotten argument away: the no-`--out` branch printed the whole
  // ~81 KB packet to stdout, where the main session holds it twice. Every caller — SKILL.md,
  // planner-prompt.md, the tech spec — already documents `--out` as mandatory, so the fallback
  // was reachable only by mistake, and a mistake that still exits 0 is one nothing reports.
  const repo = createFixtureRepo();
  const res = runPlanContext(repo, [], { omitOut: true });
  assert.equal(res.exitCode, 1, 'must fail closed rather than emit the packet to stdout');
  assert.match(res.stderr || '', /--out <path> is required/);
  assert.doesNotMatch(res.stdout || '', /skill_candidates/, 'the packet must not reach stdout on the error path');
});

test('plan-context: --out outside the repo root → exit 1 (containment)', () => {
  const repo = createFixtureRepo();
  const res = runPlanContext(repo, ['--out', '/nonexistent-root-dir-xyz/packet.json']);
  assert.equal(res.exitCode, 1, 'must fail closed rather than silently reintroduce double-injection');
  assert.match(res.stderr || '', /resolves outside the repo root/);
});

test('plan-context: --out refuses to follow a symlinked path component', () => {
  const repo = createFixtureRepo();
  const escapeTarget = mkdtempSync(join(tmpdir(), 'sd0x-escape-'));
  tempDirs.push(escapeTarget);
  // A repo shipping `.claude_workflows -> /somewhere/else` would otherwise have the packet
  // written outside the tree entirely — and run-verify excludes that directory, so the
  // write would leave no drift behind.
  symlinkSync(escapeTarget, join(repo, 'runs'));
  const res = runPlanContext(repo, ['--out', join(repo, 'runs', 'packet.json')]);
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr || '', /is a symlink — refusing to follow it/);
  assert.ok(!existsSync(join(escapeTarget, 'packet.json')), 'nothing may be written through the symlink');
});

test('plan-context: --out refuses to overwrite an existing path (exclusive create)', () => {
  const repo = createFixtureRepo();
  const outPath = join(repo, 'packet.json');
  writeFileSync(outPath, 'pre-existing\n');
  const res = runPlanContext(repo, ['--out', outPath]);
  assert.equal(res.exitCode, 1, 'a pre-placed file (or symlink) must not be clobbered');
  assert.equal(readFileSync(outPath, 'utf8'), 'pre-existing\n');
});

test('plan-context: --out without a value → exit 1', () => {
  const repo = createFixtureRepo();
  const res = runPlanContext(repo, ['--out']);
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr || '', /--out requires a value/);
});

// =============================================================================
// Config-injection guard (`core.fsmonitor`) — the plane run-verify's suite covers
// for itself, and neither of the other two orchestrate scripts covered at all
// =============================================================================

test('a repo-local core.fsmonitor program is NOT executed while gathering repo signals', () => {
  // `core.fsmonitor = <program>` is repo-local config that git EXECUTES on `status`, and this
  // script runs `status --porcelain -uall`. It also runs BEFORE `run-verify.js snapshot` in the
  // documented order, so a program firing here mutates the repo while no baseline exists yet —
  // the mutation is folded INTO the baseline and every later compare reads clean. Strictly worse
  // than the same injection against the verifier, which at least drifts.
  //
  // The guard was reasoned about in a comment but never exercised: `GIT_SAFE_CONFIG = []` passed
  // the whole suite.
  const dir = createFixtureRepo();
  const sentinel = join(dir, 'FSMONITOR_RAN');
  const hook = join(dir, 'fsmonitor-hook.sh');
  writeFileSync(hook, `#!/bin/sh\ntouch ${sentinel}\nprintf '/\\0'\n`);
  execFileSync('chmod', ['755', hook]);
  execFileSync('git', ['-C', dir, 'config', 'core.fsmonitor', hook]);
  execFileSync('git', ['-C', dir, 'config', 'core.untrackedCache', 'true']);

  const { summary } = runPlanContext(dir);

  assert.equal(
    existsSync(sentinel),
    false,
    'the repo-supplied fsmonitor program must never run while the planner reads repo signals'
  );
  // Non-vacuity: the run must have reached the git calls at all, or the sentinel's absence proves
  // only that the script exited early.
  assert.ok(summary, 'the script must have produced a summary — otherwise nothing consulted git');
});

test('DERIVED: every git invocation in the orchestrate scripts carries the config-injection guard', () => {
  // Behavioural coverage can only reach the calls that CONSULT fsmonitor. `rev-parse` does not, so
  // prune-runs.js — whose only git call is a `rev-parse` — is untestable that way today, and its
  // own comment says the override is there for "a later call being added without it". This is the
  // test for that later call: it fails when a git invocation is added without the guard, in any of
  // the three scripts, including one whose behaviour a sentinel could never detect.
  const scripts = ['plan-context.js', 'prune-runs.js', 'run-verify.js'];
  let checked = 0;

  for (const name of scripts) {
    const src = readFileSync(resolve(__dirname, '../../skills/orchestrate/scripts', name), 'utf8');
    assert.match(
      src,
      /const GIT_SAFE_CONFIG = \['-c', 'core\.fsmonitor=false'\];/,
      `${name}: GIT_SAFE_CONFIG must be the fsmonitor override — an empty array silently disarms every call below`
    );

    // Every `execFileSync('git'` / `spawnSync('git'` argument list, up to its closing bracket.
    const calls = [...src.matchAll(/(?:execFileSync|spawnSync)\(\s*'git',\s*\[([^\]]*)\]/g)];
    assert.ok(calls.length > 0, `${name}: no git invocation found — has the call shape changed?`);
    for (const c of calls) {
      checked += 1;
      assert.match(
        c[1].replace(/\s+/g, ' '),
        /\.\.\.GIT_SAFE_CONFIG/,
        `${name}: a git invocation omits GIT_SAFE_CONFIG — repo-local core.fsmonitor would execute:\n  git [${c[1].trim()}]`
      );
    }
  }
  assert.ok(checked >= 4, `only ${checked} git invocations inspected — the regex has drifted`);
});
