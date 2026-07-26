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
 *   node skills/orchestrate/scripts/plan-context.js --out <path> [--budget S|M|L]
 *     [--repo <path>] [--catalog <path>] [--skills-dir <path>]
 *     [--agents-dir <path>] [--allowlist <path>]
 *
 * `--out` is REQUIRED. The packet is ~81 KB at tier M and the main session would hold it twice
 * (tool result + the copy that persists for the rest of the conversation), which is the entire
 * cost this script exists to avoid — so there is no stdout mode to fall back to. stdout carries
 * only the summary: the packet path, its byte count, and the sha256 that binds it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
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

// Walk every component from repoRoot down to dirname(outPath), creating missing
// directories and rejecting any existing component that is a symlink. `mkdirSync`
// with `recursive: true` happily traverses a planted symlink — a repo shipping
// `.claude_workflows -> /etc` would have the packet written outside the tree
// entirely, and since run-verify excludes that directory the write leaves no drift.
function assertContainedWritePath(outPath, repoRoot) {
  const rel = path.relative(repoRoot, outPath);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    fail(`--out "${outPath}" resolves outside the repo root "${repoRoot}" — refusing to write`);
  }
  const parts = rel.split(path.sep).slice(0, -1);
  let cursor = repoRoot;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let st;
    try {
      st = fs.lstatSync(cursor);
    } catch {
      try {
        fs.mkdirSync(cursor);
      } catch (err) {
        fail(`cannot create context packet directory "${cursor}": ${err.message}`);
      }
      continue;
    }
    if (st.isSymbolicLink()) {
      fail(`--out path component "${cursor}" is a symlink — refusing to follow it`);
    }
    if (!st.isDirectory()) {
      fail(`--out path component "${cursor}" exists and is not a directory`);
    }
  }
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
    else if (a === '--out') args.out = next();
    else if (a === '--repo') args.repo = next();
    else if (a === '--catalog') args.catalog = next();
    else if (a === '--skills-dir') args.skillsDir = next();
    else if (a === '--agents-dir') args.agentsDir = next();
    else if (a === '--allowlist') args.allowlist = next();
    else fail(`unknown flag: ${a}`);
  }
  if (!BUDGET_TIERS[args.budget]) fail(`invalid --budget "${args.budget}" (expected S|M|L)`);
  // Fail closed rather than fall back. The old no-`--out` branch printed the WHOLE packet to
  // stdout, which every caller (SKILL.md, planner-prompt.md, the tech spec) already forbids and
  // which reintroduces the ~81 KB × 2 main-context cost the flag was added to remove. A silent
  // fallback is worse than an error precisely because the run still succeeds: nothing surfaces
  // the regression except the token bill.
  if (!args.out) fail('--out <path> is required (the packet is written to disk; stdout carries only the summary)');
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

// Config-injection guard — same reasoning as run-verify.js's GIT_SAFE_CONFIG, and needed here
// MORE urgently, not less. `core.fsmonitor = <program>` is a repo-local setting that git EXECUTES
// on `status`, and `status --porcelain -uall` is called below. This script runs BEFORE
// `run-verify.js snapshot` in the documented order (see skills/orchestrate/SKILL.md Workflow), so
// a program that fires here mutates the repo while the baseline does not yet exist — the mutation
// is then folded INTO the baseline and every later compare reads clean. That is strictly worse
// than the same injection against the verifier, which at least drifts.
//
// `-c` wins over repo-local config and the setting defaults to unset, so on an honest repo this
// changes nothing. `rev-parse` does not consult fsmonitor, but the override is applied to every
// invocation rather than only the one that needs it: an exception list is a future footgun the
// moment someone adds a fourth call.
const GIT_SAFE_CONFIG = ['-c', 'core.fsmonitor=false'];

function git(repo, cliArgs) {
  return execFileSync('git', ['-C', repo, ...GIT_SAFE_CONFIG, ...cliArgs], { encoding: 'utf8' }).trimEnd();
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

// Resolve the plugin root that carries the bundled metadata (docs/skill-catalog.yml, skills/,
// agents/, orchestrate references/). These are the SAME regardless of which repo is being
// orchestrated, so they come from the PLUGIN, never from --repo or a dir the target controls.
//
// SECURITY — a resolution that TRUSTS the wrong root loads that root's admission-allowlist, and
// a hostile target repo could then allowlist an Edit/Write agent and mark it fanout-eligible,
// defeating the report-only / deny-by-default guarantee. So we NEVER search arbitrary ancestors
// for a lone catalog: a discovery walkup would reach the TARGET repo (or a parent of it — the
// user's projects/home dir) and a repo that merely ships `docs/skill-catalog.yml` (a COMMON
// convention) would be mistaken for the bundle. A candidate is trusted ONLY when it carries the
// FULL, distinctive plugin signature (docs/skill-catalog.yml + skills/orchestrate/ + agents/),
// which a casual or partial plant does not satisfy.
//
// Resolution order:
//   1. CLAUDE_PLUGIN_ROOT — the authoritative, HARNESS-owned signal Claude Code injects for
//      plugin execution (never target-controlled). Trusted only if it looks like the bundle.
//   2. Fixed three-levels-up relative to THIS script's physical location (scripts → orchestrate
//      → skills → root). Correct for the in-repo plugin AND npm-install layouts, trusted only if
//      it looks like the bundle — so the /install-scripts FLATTENED layout (three-up = parent of
//      the target repo) is NOT mistaken for the plugin and instead falls through to fail-closed.
//   3. Neither signal is a full bundle → return a SENTINEL subpath (with no catalog) so main()
//      fail-closes on the missing catalog with a clear message. Deliberately NOT `fixed` itself:
//      in the flattened layout `fixed` is the parent-of-repo, and a PARTIAL plant there (a lone
//      docs/skill-catalog.yml, without skills/orchestrate/ + agents/) would satisfy main()'s
//      weaker "catalog exists" check → fail-open. (Overridable via --catalog / --skills-dir / --agents-dir.)
// RESIDUAL (documented): a full fake bundle deliberately planted at EXACTLY parent-of-repo in
// the flattened+env-unset case would still be trusted by step 2 — but that requires the attacker
// to already own the filesystem around the repo, and CLAUDE_PLUGIN_ROOT (step 1) is the intended
// path for that layout.
function resolvePluginRoot() {
  // `statSync`, not `lstatSync` — deliberate, and the one place in this file that follows symlinks
  // on purpose (the traversal guard above uses `lstatSync` precisely because it must not).
  // A symlinked bundle is an ordinary install shape: a dev checkout linked into the plugins
  // directory presents `skills/orchestrate` and `agents` as symlinks, and refusing those would
  // break working setups. It buys no safety either: an attacker who can plant a symlink at
  // parent-of-repo can plant a real directory there just as easily, which is the RESIDUAL above
  // rather than a new hole. The asymmetry is the point, not an oversight.
  const looksLikeBundle = (dir) => {
    try {
      return (
        fs.statSync(path.join(dir, 'docs', 'skill-catalog.yml')).isFile()
        && fs.statSync(path.join(dir, 'skills', 'orchestrate')).isDirectory()
        && fs.statSync(path.join(dir, 'agents')).isDirectory()
      );
    } catch {
      return false;
    }
  };
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT) : null;
  if (envRoot && looksLikeBundle(envRoot)) return envRoot;
  const fixed = path.resolve(__dirname, '..', '..', '..');
  if (looksLikeBundle(fixed)) return fixed;
  // Neither signal carries the FULL plugin signature. Returning `fixed` here would be fail-OPEN: in
  // the flattened /install-scripts layout `fixed` is the parent-of-repo, so a PARTIAL plant there
  // (a lone docs/skill-catalog.yml + allowlist, WITHOUT skills/orchestrate/ + agents/) would still
  // satisfy main()'s weaker "catalog exists" check and be loaded — the exact deny-by-default bypass
  // the full-signature gate exists to prevent. Return a sentinel subpath that provably holds no
  // catalog so main() fail-closes on "catalog missing" regardless of what is planted at `fixed` (a
  // legitimate flattened layout has no catalog at parent-of-repo either, so it already fail-closed
  // here — only the PLANTED case changes, from loaded to rejected). Override via --catalog.
  return path.join(fixed, '.sd0x-no-plugin-bundle');
}

// ── Main ──

function main() {
  const args = parseArgs(process.argv.slice(2));
  // --repo defaults to cwd: repo *signals* (branch, dirty files, features) must come
  // from the TARGET repository the user is orchestrating, not the plugin. A __dirname
  // walkup here would wrongly resolve to the installed plugin dir.
  const repo = path.resolve(args.repo || process.cwd());
  // The skill catalog, skills/, and agents/ are plugin METADATA bundled WITH this script —
  // they define the workflow vocabulary the planner composes and are the same regardless of
  // which repo is being orchestrated. resolvePluginRoot() (above) finds the bundle via
  // CLAUDE_PLUGIN_ROOT → fixed three-up, each trusted ONLY when it carries the full plugin
  // signature, so a target-repo-owned (or repo-adjacent) catalog is never mistaken for the
  // bundle and the /install-scripts flattened layout fail-closes rather than trusting --repo.
  // Defaulting to <repo>/... broke every consumer repo: the target repo has no
  // docs/skill-catalog.yml, so the default invocation exited on "catalog missing".
  // (docs/skill-catalog.yml is shipped via package.json "files" so it is present under the
  // plugin root in npm-install layout too.)
  const pluginRoot = resolvePluginRoot();
  const catalogPath = path.resolve(args.catalog || path.join(pluginRoot, 'docs', 'skill-catalog.yml'));
  const skillsDir = path.resolve(args.skillsDir || path.join(pluginRoot, 'skills'));
  const agentsDir = path.resolve(args.agentsDir || path.join(pluginRoot, 'agents'));
  const allowlistPath = path.resolve(
    args.allowlist || path.join(pluginRoot, 'skills', 'orchestrate', 'references', 'admission-allowlist.json'),
  );

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
  // `--out` writes the packet to disk and prints only a summary. The full packet is
  // planner input, but without this the main session pays for it TWICE — once as the
  // Bash tool result, once embedded in the planner prompt (~40K tokens per invocation
  // at tier M, and the main-session copy persists for the rest of the conversation).
  // The planner reads the path instead; `Explore` has Read. Fail-closed: an unwritable
  // path aborts rather than silently falling back to stdout, which would reintroduce
  // the double-injection the flag exists to prevent.
  // `args.out` is guaranteed by parseArgs — there is deliberately no stdout-packet branch.
  {
    const outPath = path.resolve(args.out);
    const payload = `${serialized}\n`;
    assertContainedWritePath(outPath, path.resolve(repo));
    try {
      // 'wx' = exclusive create: fails if anything already occupies the path, including a
      // planted symlink. Combined with the component walk above this keeps the write inside
      // the repo. Run ids are unique, so refusing to overwrite costs nothing.
      fs.writeFileSync(outPath, payload, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      fail(`cannot write context packet to "${outPath}": ${err.message}`);
    }
    // The packet lands on a surface the planner can both read and write, and `run-verify.js`
    // deliberately excludes that surface from drift detection. Without an integrity binding a
    // Bash-capable planner could append itself a denied agent to `admission.allowlist` (or a
    // fabricated entry to `skill_candidates`), return a plan matching the doctored packet, and
    // sail through validate-plan's A1/A4 with no drift recorded. The digest is computed here,
    // travels via the summary (main session, outside planner reach), and validate-plan
    // re-hashes the file before trusting a single field of it.
    const sha256 = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
    const summary = {
      schema_version: 1,
      context_path: outPath,
      bytes: Buffer.byteLength(serialized, 'utf8'),
      sha256,
      budget: output.budget,
      admission: output.admission,
      counts: {
        skill_candidates: skillCandidates.length,
        agent_candidates: agentCandidates.length,
        repo_features: output.repo_signals.features.length,
      },
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

main();
