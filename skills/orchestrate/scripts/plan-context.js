#!/usr/bin/env node
/**
 * plan-context.js — deterministic planner-input assembly for /orchestrate (v1).
 *
 * Reads docs/skill-catalog.yml + skills/<name>/SKILL.md frontmatter +
 * agents/<name>.md frontmatter + admission allowlist + repo signals, and emits
 * a single JSON document on stdout for the planner agent.
 *
 * Fail-closed contract (NFR-3): missing/unparseable catalog, agents dir,
 * allowlist file, or assembled output exceeding the budget tier's
 * max_context_bytes → stderr message + exit 1. Never silently truncates and
 * never emits partial candidates.
 *
 * Usage:
 *   node skills/orchestrate/scripts/plan-context.js [--budget S|M|L]
 *     [--repo <path>] [--catalog <path>] [--skills-dir <path>]
 *     [--agents-dir <path>] [--allowlist <path>]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const BUDGET_TIERS = {
  S: { tier: 'S', max_workers: 2, max_waves: 1, max_plan_steps: 8, max_context_bytes: 64 * 1024 },
  M: { tier: 'M', max_workers: 3, max_waves: 2, max_plan_steps: 15, max_context_bytes: 128 * 1024 },
  L: { tier: 'L', max_workers: 4, max_waves: 3, max_plan_steps: 25, max_context_bytes: 256 * 1024 },
};

function fail(msg) {
  process.stderr.write(`[plan-context] FAIL-CLOSED: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { budget: 'M' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) fail(`flag ${a} requires a value`);
      return argv[i];
    };
    if (a === '--budget') args.budget = next();
    else if (a === '--repo') args.repo = next();
    else if (a === '--catalog') args.catalog = next();
    else if (a === '--skills-dir') args.skillsDir = next();
    else if (a === '--agents-dir') args.agentsDir = next();
    else if (a === '--allowlist') args.allowlist = next();
    else fail(`unknown flag: ${a}`);
  }
  if (!BUDGET_TIERS[args.budget]) fail(`invalid --budget "${args.budget}" (expected S|M|L)`);
  return args;
}

// ── Lightweight YAML parser (flat catalog structure; mirrors generate-readme-catalog.js,
//    but strict: any line that doesn't match the expected shape → exit 1 (NFR-3).
//    A lenient parser that silently drops malformed lines would let corrupted
//    metadata flow into the planner instead of failing closed. ──

function parseKV(obj, text, lineNo) {
  const m = text.match(/^(\w[\w_-]*):\s*(.*)/);
  if (!m) fail(`catalog line ${lineNo} unparseable key/value: "${text}"`);
  const [, key, raw] = m;
  let val = raw.replace(/^"/, '').replace(/"$/, '').trim();
  if (val === 'true') val = true;
  else if (val === 'false') val = false;
  obj[key] = val;
}

function parseCatalogYaml(text) {
  const result = { version: 1, categories: [], skills: [] };
  let current = null;
  let item = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    const lineNo = i + 1;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^version:/.test(line)) {
      const m = line.match(/^version:\s*(\d+)$/);
      if (!m) fail(`catalog line ${lineNo} invalid version: "${line}"`);
      result.version = parseInt(m[1], 10);
      continue;
    }
    if (line === 'categories:' || line === 'skills:') {
      if (item && current) result[current].push(item);
      item = null;
      current = line.replace(':', '');
      continue;
    }
    if (/^\s{2}- /.test(line)) {
      if (!current) fail(`catalog line ${lineNo} list item outside a known section: "${line.trim()}"`);
      if (item) result[current].push(item);
      item = {};
      parseKV(item, line.replace(/^\s{2}- /, ''), lineNo);
      continue;
    }
    if (/^\s{4}\S/.test(line)) {
      if (!item) fail(`catalog line ${lineNo} property without a list item: "${line.trim()}"`);
      parseKV(item, line.trim(), lineNo);
      continue;
    }
    fail(`catalog line ${lineNo} unparseable: "${line.trim()}"`);
  }
  if (item && current) result[current].push(item);
  return result;
}

// ── SKILL.md frontmatter description (use_when fallback source) ──

function loadSkillDescriptions(skillsDir) {
  const descs = {};
  let dirs;
  try {
    dirs = fs.readdirSync(skillsDir).filter((d) => fs.statSync(path.join(skillsDir, d)).isDirectory());
  } catch (e) {
    fail(`skills dir unreadable: ${skillsDir} (${e.message})`);
  }
  for (const dir of dirs) {
    let content;
    try {
      content = fs.readFileSync(path.join(skillsDir, dir, 'SKILL.md'), 'utf8');
    } catch {
      continue; // skill dir without SKILL.md — catalog validation owns this concern
    }
    const fm = content.match(/^---\n([\s\S]+?)\n---/);
    if (!fm) continue;
    const descLine = fm[1].split('\n').find((l) => l.startsWith('description:'));
    if (!descLine) continue;
    descs[dir] = descLine.replace(/^description:\s*"?/, '').replace(/"?\s*$/, '');
  }
  return descs;
}

// ── Agents frontmatter ──

function loadAgents(agentsDir) {
  let files;
  try {
    files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  } catch (e) {
    fail(`agents dir unreadable: ${agentsDir} (${e.message})`);
  }
  const agents = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(agentsDir, f), 'utf8');
    // Strict: tools must come from a proper frontmatter block, not any line in
    // the body — a missing block means corrupted agent metadata (fail-closed).
    const fm = content.match(/^---\n([\s\S]+?)\n---/);
    if (!fm) fail(`agent ${f} missing frontmatter block — cannot trust its tool declaration`);
    const toolsLine = fm[1].split('\n').find((l) => l.startsWith('tools:'));
    agents.push({
      name: f.replace(/\.md$/, ''),
      tools: toolsLine ? toolsLine.replace(/^tools:\s*/, '').trim() : null,
    });
  }
  return agents;
}

// ── Admission allowlist (fail-closed on missing/invalid; expected_tools must match frontmatter) ──

function loadAllowlist(allowlistPath, agents) {
  let raw;
  try {
    raw = fs.readFileSync(allowlistPath, 'utf8');
  } catch (e) {
    fail(`admission allowlist missing/unreadable: ${allowlistPath} (${e.message})`);
  }
  let allowlist;
  try {
    allowlist = JSON.parse(raw);
  } catch (e) {
    fail(`admission allowlist is not valid JSON: ${e.message}`);
  }
  if (allowlist.mode !== 'deny-by-default' || !Array.isArray(allowlist.fanout_allowlist)) {
    fail('admission allowlist must declare mode "deny-by-default" with a fanout_allowlist array');
  }
  const agentByName = new Map(agents.map((a) => [a.name, a]));
  for (const entry of allowlist.fanout_allowlist) {
    if (entry.type === 'repo-agent') {
      const agent = agentByName.get(entry.name);
      if (!agent) fail(`allowlisted repo-agent "${entry.name}" not found in agents dir`);
      if (agent.tools !== entry.expected_tools) {
        fail(
          `allowlist drift for "${entry.name}": expected_tools "${entry.expected_tools}" != frontmatter "${agent.tools}" — re-review admission before proceeding`
        );
      }
    }
  }
  return allowlist;
}

// ── Repo signals ──

function git(repo, cliArgs) {
  return execFileSync('git', ['-C', repo, ...cliArgs], { encoding: 'utf8' }).trimEnd();
}

function loadRepoSignals(repo) {
  let branch;
  let head;
  let dirtyCount;
  try {
    branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    head = git(repo, ['rev-parse', 'HEAD']);
    const porcelain = git(repo, ['status', '--porcelain', '-uall']);
    dirtyCount = porcelain === '' ? 0 : porcelain.split('\n').length;
  } catch (e) {
    fail(`git signals unavailable: ${e.message}`);
  }
  const features = [];
  const featuresDir = path.join(repo, 'docs', 'features');
  if (fs.existsSync(featuresDir)) {
    for (const dir of fs.readdirSync(featuresDir)) {
      const full = path.join(featuresDir, dir);
      if (!fs.statSync(full).isDirectory()) continue;
      const docs = fs.readdirSync(full).filter((f) => /^\d+-.*\.md$/.test(f));
      features.push({ feature: dir, lifecycle_docs: docs.sort() });
    }
  }
  return { branch, head, dirty_files_count: dirtyCount, features };
}

// ── Main ──

function main() {
  const args = parseArgs(process.argv.slice(2));
  // Default --repo to cwd (consistent with run-verify.js); a __dirname walkup
  // would resolve to <project>/.claude under the installed-copy layout.
  const repo = path.resolve(args.repo || process.cwd());
  const catalogPath = path.resolve(args.catalog || path.join(repo, 'docs', 'skill-catalog.yml'));
  const skillsDir = path.resolve(args.skillsDir || path.join(repo, 'skills'));
  const agentsDir = path.resolve(args.agentsDir || path.join(repo, 'agents'));
  const allowlistPath = path.resolve(args.allowlist || path.join(__dirname, '..', 'references', 'admission-allowlist.json'));

  let catalogText;
  try {
    catalogText = fs.readFileSync(catalogPath, 'utf8');
  } catch (e) {
    fail(`catalog missing/unreadable: ${catalogPath} (${e.message})`);
  }
  const catalog = parseCatalogYaml(catalogText);
  if (!catalog.skills.length) fail(`catalog parsed to zero skill entries: ${catalogPath}`);
  const categoryIds = new Set(catalog.categories.map((c) => c.id));

  const descriptions = loadSkillDescriptions(skillsDir);
  const skillCandidates = catalog.skills.map((s) => {
    const name = String(s.command || '').replace(/^\//, '');
    if (!name) fail('catalog entry without a command field');
    if (!s.category || !categoryIds.has(s.category)) {
      fail(`catalog entry ${s.command} references unknown category "${s.category}"`);
    }
    const description = descriptions[name] || null;
    return {
      command: s.command,
      category: s.category,
      featured: s.featured === true,
      public: s.public === true,
      // T1 fallback contract: when the catalog omits use_when, the SKILL.md
      // frontmatter description is the planner's "when to use" signal.
      use_when: s.use_when || description,
      description,
    };
  });

  const agents = loadAgents(agentsDir);
  const allowlist = loadAllowlist(allowlistPath, agents);
  const allowedNames = new Set(allowlist.fanout_allowlist.map((e) => e.name));

  const agentCandidates = [
    ...allowlist.fanout_allowlist
      .filter((e) => e.type === 'builtin')
      .map((e) => ({ name: e.name, tools: null, fanout_eligible: true })),
    ...agents.map((a) => ({
      name: a.name,
      tools: a.tools,
      fanout_eligible: allowedNames.has(a.name),
      ...(allowedNames.has(a.name) ? {} : { deny_reason: 'not in admission allowlist (deny-by-default)' }),
    })),
  ];

  const output = {
    schema_version: 1,
    budget: BUDGET_TIERS[args.budget],
    admission: {
      mode: allowlist.mode,
      allowlist: allowlist.fanout_allowlist.map((e) => e.name),
    },
    skill_candidates: skillCandidates,
    agent_candidates: agentCandidates,
    repo_signals: loadRepoSignals(repo),
  };

  const serialized = JSON.stringify(output, null, 2);
  if (Buffer.byteLength(serialized, 'utf8') > output.budget.max_context_bytes) {
    fail(
      `assembled context ${Buffer.byteLength(serialized, 'utf8')} bytes exceeds tier ${args.budget} cap ${output.budget.max_context_bytes} — raise --budget or narrow scope (sources: catalog=${skillCandidates.length} entries, agents=${agentCandidates.length}, features=${output.repo_signals.features.length})`
    );
  }
  process.stdout.write(`${serialized}\n`);
}

main();
