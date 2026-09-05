#!/usr/bin/env node
'use strict';

/**
 * scan-repo.js — Sharingan repo scanner
 *
 * Analyzes external GitHub repos to identify skill structures,
 * build dependency graphs, and prepare generation plans.
 *
 * Output:
 *  --format json (default): structured analysis for downstream tooling
 *  --format markdown: human-readable analysis report
 *
 * Exit codes: 0 = success, 1 = warning, 2 = error
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Plugin root resolution (standard pattern)
// ---------------------------------------------------------------------------
const _pluginRoot = (() => {
  const sentinel = p => fs.existsSync(path.join(p, 'scripts', 'lib', 'utils.js'));
  const marker = p => fs.existsSync(path.join(p, '.claude-plugin', 'plugin.json'));
  const envRoot = process.env.PLUGIN_ROOT;
  if (envRoot && sentinel(envRoot) && marker(envRoot)) return envRoot;
  let d = __dirname;
  while (d !== path.dirname(d)) {
    if (sentinel(d) && marker(d)) return d;
    d = path.dirname(d);
  }
  return path.resolve(__dirname, '..', '..', '..');
})();

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function argVal(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

// ---------------------------------------------------------------------------
// Phase 0: Input Validation
// ---------------------------------------------------------------------------
const GITHUB_URL_RE = /^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/;

function validateGitHubUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }
  const m = url.match(GITHUB_URL_RE);
  if (!m) {
    return { valid: false, error: `Invalid GitHub URL: ${url}` };
  }
  return { valid: true, owner: m[1], repo: m[2] };
}

function validateTargetDir(targetDir, projectRoot) {
  if (!targetDir || typeof targetDir !== 'string') {
    return { valid: false, error: 'Target directory is required' };
  }
  if (path.isAbsolute(targetDir)) {
    return { valid: false, error: 'Absolute paths not allowed for --target-dir' };
  }
  if (targetDir.includes('..')) {
    return { valid: false, error: 'Path traversal (..) not allowed in --target-dir' };
  }
  const resolved = path.resolve(projectRoot, targetDir);
  try {
    const real = fs.realpathSync(resolved);
    const rootReal = fs.realpathSync(projectRoot);
    const rel = path.relative(rootReal, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { valid: false, error: 'Target directory outside project root' };
    }
    return { valid: true, resolved: real };
  } catch {
    // Directory may not exist yet — check parent
    const parent = path.dirname(resolved);
    try {
      const parentReal = fs.realpathSync(parent);
      const rootReal = fs.realpathSync(projectRoot);
      const rel = path.relative(rootReal, parentReal);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { valid: false, error: 'Target directory outside project root' };
      }
      return { valid: true, resolved };
    } catch {
      return { valid: false, error: `Parent directory does not exist: ${parent}` };
    }
  }
}

function checkGhAuth() {
  const r = spawnSync('gh', ['auth', 'status'], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    return { authenticated: false, error: 'GitHub CLI not authenticated. Run: gh auth login' };
  }
  return { authenticated: true };
}

// ---------------------------------------------------------------------------
// Phase 1: SCAN
// ---------------------------------------------------------------------------
function fetchRepoTree(owner, repo) {
  const r = spawnSync('gh', ['api', `repos/${owner}/${repo}/git/trees/HEAD?recursive=1`], {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    const stderr = (r.stderr || '').trim();
    return { tree: [], error: `GitHub API error: ${stderr || 'unknown'}` };
  }
  try {
    const data = JSON.parse(r.stdout);
    const tree = (data.tree || []).map(item => ({
      path: item.path,
      type: item.type,
      size: item.size || 0,
    }));
    return { tree };
  } catch (e) {
    return { tree: [], error: `Failed to parse API response: ${e.message}` };
  }
}

function fetchFileContent(owner, repo, filePath) {
  const r = spawnSync('gh', ['api', `repos/${owner}/${repo}/contents/${filePath}`], {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    return { content: '', error: `Failed to fetch ${filePath}` };
  }
  try {
    const data = JSON.parse(r.stdout);
    if (data.content) {
      const decoded = Buffer.from(data.content, 'base64').toString('utf8');
      return { content: sanitize(decoded) };
    }
    if (data.download_url) {
      return { content: '', error: `File too large, use download_url: ${data.download_url}` };
    }
    return { content: '', error: 'No content field in API response' };
  } catch (e) {
    return { content: '', error: `Failed to parse file content: ${e.message}` };
  }
}

function classifyRepo(tree) {
  const paths = tree.map(t => t.path);
  if (paths.some(p => p === '.claude-plugin/plugin.json')) return 'plugin';
  if (paths.some(p => /^skills\/[^/]+\/SKILL\.md$/.test(p))) return 'collection';
  if (paths.some(p => p === 'SKILL.md')) return 'single';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------
function parseFrontmatter(content) {
  if (!content || !content.startsWith('---')) return null;
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return null;
  const block = content.substring(3, endIdx).trim();
  const result = {};
  for (const line of block.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    let val = line.substring(colonIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  if (!result.name) return null;
  return result;
}

// ---------------------------------------------------------------------------
// Skill extraction
// ---------------------------------------------------------------------------
function extractSkills(tree, owner, repo, filterSkill) {
  const repoType = classifyRepo(tree);
  const skillPaths = [];

  if (repoType === 'single') {
    // Always push; filter applied after frontmatter name is known
    skillPaths.push({ name: repo, skillMdPath: 'SKILL.md', basePath: '', filterDeferred: true });
  } else {
    const skillMdFiles = tree.filter(t => /^skills\/[^/]+\/SKILL\.md$/.test(t.path));
    for (const f of skillMdFiles) {
      const parts = f.path.split('/');
      const name = parts[1];
      if (filterSkill && name !== filterSkill) continue;
      skillPaths.push({ name, skillMdPath: f.path, basePath: `skills/${name}/` });
    }
  }

  const skills = [];
  for (const sp of skillPaths) {
    const { content, error } = fetchFileContent(owner, repo, sp.skillMdPath);
    if (error) {
      skills.push({
        name: sp.name, source_path: sp.skillMdPath, error,
        frontmatter: {}, body_sections: [], references: [], scripts: [],
        dependencies: { skills: [], rules: [], tools: [], mcp_servers: [] },
      });
      continue;
    }

    const frontmatter = parseFrontmatter(content);
    const bodySections = extractSections(content);
    const references = tree
      .filter(t => t.path.startsWith(`${sp.basePath}references/`) && t.type === 'blob')
      .map(t => t.path);
    const scripts = tree
      .filter(t => t.path.startsWith(`${sp.basePath}scripts/`) && t.type === 'blob')
      .map(t => t.path);
    const dependencies = extractDependencies(content);

    const skillName = (frontmatter && frontmatter.name) || sp.name;
    // Deferred filter for single-repo: check both frontmatter name and repo slug
    if (sp.filterDeferred && filterSkill && filterSkill !== skillName && filterSkill !== sp.name) {
      continue;
    }
    skills.push({
      name: skillName,
      source_path: sp.skillMdPath,
      frontmatter: frontmatter || {},
      body_sections: bodySections,
      references,
      scripts,
      dependencies,
      body_content: content,
    });
  }
  return skills;
}

function extractSections(content) {
  const lines = content.split('\n');
  const sections = [];
  for (const line of lines) {
    const m = line.match(/^#{2,3}\s+(.+)/);
    if (m) sections.push(m[1].trim());
  }
  return sections;
}

function extractDependencies(content) {
  const skills = [];
  const rules = [];
  const tools = [];
  const mcp_servers = [];

  // /skill-name references (in body, not in code blocks)
  const skillRefs = content.match(/(?:^|\s)\/([a-z][a-z0-9-]+)/gm) || [];
  for (const ref of skillRefs) {
    const name = ref.trim().replace(/^\//, '');
    if (name && !skills.includes(name)) skills.push(name);
  }

  // @rules/* references
  const ruleRefs = content.match(/@rules\/[a-z0-9_.-]+\.md/g) || [];
  for (const ref of ruleRefs) {
    if (!rules.includes(ref)) rules.push(ref);
  }

  // allowed-tools from frontmatter
  const toolMatch = content.match(/allowed-tools:\s*(.+)/);
  if (toolMatch) {
    const toolList = toolMatch[1].split(',').map(t => t.trim()).filter(Boolean);
    tools.push(...toolList);
  }

  // mcp__*__ patterns
  const mcpRefs = content.match(/mcp__[a-zA-Z0-9_]+__[a-zA-Z0-9_-]+/g) || [];
  for (const ref of mcpRefs) {
    if (!mcp_servers.includes(ref)) mcp_servers.push(ref);
  }

  return { skills, rules, tools, mcp_servers };
}

// ---------------------------------------------------------------------------
// Dependency Graph
// ---------------------------------------------------------------------------

/**
 * Build dependency graph from extracted skills.
 * Edge direction: dependency → dependent (A → B means "A is used by B")
 */
function buildDependencyGraph(skills) {
  const skillNames = new Set(skills.map(s => s.name));
  const nodes = [...skillNames];
  const edges = [];

  for (const skill of skills) {
    const deps = (skill.dependencies && skill.dependencies.skills) || [];
    for (const dep of deps) {
      if (skillNames.has(dep) && dep !== skill.name) {
        edges.push({ from: dep, to: skill.name, type: 'skill' });
      }
    }
  }

  const cycles = detectCycles(nodes, edges);
  const leafSkills = findLeafSkills(nodes, edges);
  const rootSkills = findRootSkills(nodes, edges);
  const batches = topoSort(nodes, edges, cycles);
  const needHuman = cycles.some(c => c.length > 3);

  return { nodes, edges, leafSkills, rootSkills, batches, cycles, needHuman };
}

/**
 * Tarjan's SCC algorithm for cycle detection.
 * Returns array of strongly connected components with size > 1.
 */
function detectCycles(nodes, edges) {
  const adj = new Map();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from).push(e.to);
  }

  let index = 0;
  const indices = new Map();
  const lowlinks = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  function strongConnect(v) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of (adj.get(v) || [])) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) sccs.push(scc);
    }
  }

  for (const n of nodes) {
    if (!indices.has(n)) strongConnect(n);
  }
  return sccs;
}

/**
 * Find leaf skills (in-degree 0 — no dependencies on other skills).
 */
function findLeafSkills(nodes, edges) {
  const hasIncoming = new Set(edges.map(e => e.to));
  return nodes.filter(n => !hasIncoming.has(n));
}

/**
 * Find root skills (out-degree 0 — nothing depends on them).
 */
function findRootSkills(nodes, edges) {
  const hasOutgoing = new Set(edges.map(e => e.from));
  return nodes.filter(n => !hasOutgoing.has(n));
}

/**
 * Topological sort using Kahn's algorithm.
 * Collapses cycles into single nodes. Returns batches (same-depth grouped).
 */
function topoSort(nodes, edges, cycles) {
  // Collapse cycles into representative nodes
  const cycleMap = new Map(); // node → representative
  for (const scc of cycles) {
    const rep = scc[0];
    for (const n of scc) cycleMap.set(n, rep);
  }
  const rep = n => cycleMap.get(n) || n;

  const uniqueNodes = [...new Set(nodes.map(rep))];
  const adjOut = new Map();
  const inDeg = new Map();
  for (const n of uniqueNodes) { adjOut.set(n, new Set()); inDeg.set(n, 0); }

  for (const e of edges) {
    const from = rep(e.from);
    const to = rep(e.to);
    if (from !== to && !adjOut.get(from).has(to)) {
      adjOut.get(from).add(to);
      inDeg.set(to, (inDeg.get(to) || 0) + 1);
    }
  }

  const batches = [];
  let queue = uniqueNodes.filter(n => inDeg.get(n) === 0);

  while (queue.length > 0) {
    // Expand representatives back to original nodes for this batch
    const batch = [];
    for (const q of queue) {
      const scc = cycles.find(c => c[0] === q);
      if (scc) batch.push(...scc);
      else batch.push(q);
    }
    batches.push(batch);

    const nextQueue = [];
    for (const n of queue) {
      for (const neighbor of (adjOut.get(n) || [])) {
        inDeg.set(neighbor, inDeg.get(neighbor) - 1);
        if (inDeg.get(neighbor) === 0) nextQueue.push(neighbor);
      }
    }
    queue = nextQueue;
  }

  return batches;
}

// ---------------------------------------------------------------------------
// Format Mapping
// ---------------------------------------------------------------------------
function mapFormat(skill, localContext) {
  const { localSkills = [], localRules = [], localTools = [] } = localContext || {};
  const mapped = {
    name: skill.name,
    frontmatter: { ...skill.frontmatter },
    body_sections: skill.body_sections || [],
  };
  const untranslatable = [];

  // Check tool availability
  const tools = (skill.dependencies && skill.dependencies.tools) || [];
  for (const tool of tools) {
    if (localTools.length > 0 && !localTools.includes(tool)) {
      untranslatable.push({
        element: tool,
        reason: 'Tool not available in target project',
        suggestion: `[MISSING_TOOL] Remove or replace ${tool}`,
      });
    }
  }

  // Check skill references
  const skillRefs = (skill.dependencies && skill.dependencies.skills) || [];
  for (const ref of skillRefs) {
    if (localSkills.length > 0 && !localSkills.includes(ref)) {
      untranslatable.push({
        element: `/${ref}`,
        reason: 'Referenced skill not found in target project',
        suggestion: `[MISSING_SKILL] Install or remove /${ref} reference`,
      });
    }
  }

  // Check rule references
  const ruleRefs = (skill.dependencies && skill.dependencies.rules) || [];
  for (const ref of ruleRefs) {
    if (localRules.length > 0 && !localRules.includes(ref)) {
      untranslatable.push({
        element: ref,
        reason: 'Rule not found in target project',
        suggestion: `[MISSING_RULE] Install or remove ${ref} reference`,
      });
    }
  }

  // Check MCP servers
  const mcpRefs = (skill.dependencies && skill.dependencies.mcp_servers) || [];
  for (const ref of mcpRefs) {
    untranslatable.push({
      element: ref,
      reason: 'MCP server dependency — verify availability',
      suggestion: `[MISSING_MCP] Ensure ${ref} is configured in target project`,
    });
  }

  return { mapped, untranslatable };
}

// ---------------------------------------------------------------------------
// Security Envelope (v2)
// ---------------------------------------------------------------------------
function validateSecureUrl(url) {
  if (!url || typeof url !== 'string') return { valid: false, error: 'URL is required' };
  let parsed;
  try { parsed = new URL(url); } catch { return { valid: false, error: `Invalid URL: ${url}` }; }
  if (parsed.protocol !== 'https:') return { valid: false, error: 'Only HTTPS URLs allowed' };
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const denyPatterns = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^localhost$/i,
    /^::1$/,
    /^\[::1\]$/,
    /^0\.0\.0\.0$/,
    /^169\.254\./,                 // link-local (cloud metadata)
    /^::ffff:/i,          // IPv4-mapped IPv6
    /^fc[0-9a-f]{2}:/i,   // IPv6 unique local (fc00::/7)
    /^fd[0-9a-f]{2}:/i,   // IPv6 unique local (fd00::/8)
    /^fe80:/i,             // IPv6 link-local
  ];
  for (const pat of denyPatterns) {
    if (pat.test(host)) return { valid: false, error: `Private/reserved address denied: ${host}` };
  }
  return { valid: true, parsed };
}

function validatePayloadSize(content, maxBytes = 500000) {
  if (!content) return { valid: true, byteLength: 0 };
  const len = Buffer.byteLength(content, 'utf8');
  if (len > maxBytes) {
    return { valid: false, error: `Payload ${len} bytes exceeds limit ${maxBytes}`, byteLength: len };
  }
  return { valid: true, byteLength: len };
}

// ---------------------------------------------------------------------------
// SourceBundle Builder (v2)
// ---------------------------------------------------------------------------
function toSourceBundle(analysis) {
  if (!analysis.skills || analysis.skills.length === 0) return null;
  const allTools = new Set();
  const patterns = analysis.skills.map(s => {
    for (const t of (s.dependencies?.tools || [])) allTools.add(t);
    return {
      name: s.name,
      description: (s.frontmatter?.description) || '',
      workflow: (s.body_sections || []).join(' → ') || null,
      code_examples: [],
      source_ref: s.source_path || '',
    };
  });

  const intent = patterns.length > 0
    ? `Replicate ${analysis.repo?.name || 'repo'} as sd0x-dev-flow skill`
    : 'No skills found in repository';

  return {
    source: {
      type: 'github_repo',
      origin: analysis.repo?.url || '',
      confidence: 'high',
      fetched_at: new Date().toISOString(),
    },
    knowledge: {
      intent,
      patterns,
      conventions: [],
      tools_mentioned: [...allTools],
    },
    repo_analysis: analysis,
    synthesis_hints: {
      suggested_skill_name: patterns.length === 1 ? patterns[0].name : null,
      suggested_triggers: [],
      suggested_exclusions: [],
      untranslatable: (analysis.untranslatable || []).map(u => ({
        element: u.element,
        reason: u.reason,
        suggestion: u.suggestion,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------
function sanitize(s) {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderMarkdown(analysis) {
  const lines = [];
  lines.push(`## Sharingan Analysis Report\n`);
  lines.push(`**Source**: ${analysis.repo.url}`);
  lines.push(`**Type**: ${analysis.repo.type}`);
  lines.push(`**Skills Found**: ${analysis.skills.length}`);
  lines.push(`**Analysis Date**: ${new Date().toISOString().split('T')[0]}\n`);

  if (analysis.dependency_graph.nodes.length > 0) {
    lines.push(`### Dependency Graph\n`);
    lines.push('```mermaid');
    lines.push('graph TD');
    for (const e of analysis.dependency_graph.edges) {
      lines.push(`    ${e.from} --> ${e.to}`);
    }
    if (analysis.dependency_graph.edges.length === 0) {
      for (const n of analysis.dependency_graph.nodes) {
        lines.push(`    ${n}`);
      }
    }
    lines.push('```\n');
  }

  lines.push(`### Per-Skill Summary\n`);
  lines.push('| # | Skill | Sections | Deps | References | Scripts |');
  lines.push('|---|-------|----------|------|------------|---------|');
  analysis.skills.forEach((s, i) => {
    const deps = s.dependencies ? s.dependencies.skills.length : 0;
    lines.push(`| ${i + 1} | ${s.name} | ${s.body_sections.length} | ${deps} | ${s.references.length} | ${s.scripts.length} |`);
  });

  if (analysis.untranslatable.length > 0) {
    lines.push(`\n### Untranslatable Elements\n`);
    lines.push('| Skill | Element | Reason | Suggestion |');
    lines.push('|-------|---------|--------|------------|');
    for (const u of analysis.untranslatable) {
      lines.push(`| ${u.skill} | ${u.element} | ${u.reason} | ${u.suggestion} |`);
    }
  }

  if (analysis.dependency_graph.batches.length > 0) {
    lines.push(`\n### Generation Plan\n`);
    lines.push('| Batch | Skills | Count |');
    lines.push('|-------|--------|-------|');
    analysis.dependency_graph.batches.forEach((b, i) => {
      lines.push(`| ${i + 1} | ${b.join(', ')} | ${b.length} |`);
    });
  }

  if (analysis.dependency_graph.needHuman) {
    lines.push(`\n> **Warning**: Cycle with >3 skills detected. Human review required.\n`);
  }

  lines.push(`\n### Next Steps`);
  lines.push(`1. Review analysis and confirm batch order`);
  lines.push(`2. Run \`/sharingan <url> --mode generate\` to proceed`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const positional = args.filter(a => !a.startsWith('--'));
  const url = positional[0];
  const format = argVal('--format', 'json');
  const filterSkill = argVal('--skill', null);
  const targetDir = argVal('--target-dir', 'skills/');

  // Phase 0: Validate input
  const urlResult = validateGitHubUrl(url);
  if (!urlResult.valid) {
    const err = { error: urlResult.error, url: url || '' };
    process.stdout.write(JSON.stringify(err, null, 2));
    process.exit(2);
  }

  const authResult = checkGhAuth();
  if (!authResult.authenticated) {
    const err = { error: authResult.error };
    process.stdout.write(JSON.stringify(err, null, 2));
    process.exit(2);
  }

  // Validate target directory containment
  const projectRoot = process.cwd();
  const targetResult = validateTargetDir(targetDir, projectRoot);
  if (!targetResult.valid) {
    const err = { error: targetResult.error, targetDir };
    process.stdout.write(JSON.stringify(err, null, 2));
    process.exit(2);
  }

  // Phase 1: Scan
  const { tree, error: treeError } = fetchRepoTree(urlResult.owner, urlResult.repo);
  if (treeError) {
    const err = { error: treeError };
    process.stdout.write(JSON.stringify(err, null, 2));
    process.exit(2);
  }

  const repoType = classifyRepo(tree);
  const skills = extractSkills(tree, urlResult.owner, urlResult.repo, filterSkill);

  if (skills.length === 0) {
    const result = {
      warning: 'No skills found in repository',
      repo: { owner: urlResult.owner, name: urlResult.repo, url, type: repoType },
      skills: [],
      dependency_graph: { nodes: [], edges: [], leafSkills: [], rootSkills: [], batches: [], cycles: [] },
      untranslatable: [],
    };
    if (format === 'markdown') {
      process.stdout.write(renderMarkdown(result));
    } else {
      process.stdout.write(JSON.stringify(result, null, 2));
    }
    process.exit(1);
  }

  // Build dependency graph
  const depGraph = buildDependencyGraph(skills);

  // Build local context for format mapping
  const localContext = {
    localSkills: [],
    localRules: [],
    localTools: [
      'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'Bash(git:*)', 'Bash(node:*)',
      'Bash(gh:*)', 'Bash(bash:*)', 'Agent', 'WebSearch', 'WebFetch', 'AskUserQuestion',
      'Skill',
    ],
  };
  try {
    const skillsDir = path.resolve(projectRoot, 'skills');
    if (fs.existsSync(skillsDir)) {
      localContext.localSkills = fs.readdirSync(skillsDir)
        .filter(d => fs.statSync(path.join(skillsDir, d)).isDirectory());
    }
    const rulesDir = path.resolve(projectRoot, 'rules');
    if (fs.existsSync(rulesDir)) {
      localContext.localRules = fs.readdirSync(rulesDir)
        .filter(f => f.endsWith('.md'))
        .map(f => `@rules/${f}`);
    }
  } catch { /* graceful degradation */ }

  // Format mapping
  const untranslatable = [];
  for (const skill of skills) {
    const { untranslatable: ut } = mapFormat(skill, localContext);
    for (const u of ut) {
      untranslatable.push({ skill: skill.name, ...u });
    }
  }

  // Build analysis result
  const analysis = {
    version: 1,
    repo: { owner: urlResult.owner, name: urlResult.repo, url, type: repoType },
    skills: skills.map(s => ({
      name: s.name,
      source_path: s.source_path,
      frontmatter: s.frontmatter,
      body_sections: s.body_sections,
      references: s.references,
      scripts: s.scripts,
      dependencies: s.dependencies,
    })),
    dependency_graph: depGraph,
    untranslatable,
  };

  if (format === 'markdown') {
    process.stdout.write(renderMarkdown(analysis));
  } else {
    process.stdout.write(JSON.stringify(analysis, null, 2));
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Exports (for testability)
// ---------------------------------------------------------------------------
module.exports = {
  validateGitHubUrl,
  validateTargetDir,
  checkGhAuth,
  fetchRepoTree,
  fetchFileContent,
  classifyRepo,
  parseFrontmatter,
  extractSkills,
  extractSections,
  extractDependencies,
  buildDependencyGraph,
  detectCycles,
  topoSort,
  findLeafSkills,
  findRootSkills,
  mapFormat,
  sanitize,
  renderMarkdown,
  GITHUB_URL_RE,
  validateSecureUrl,
  validatePayloadSize,
  toSourceBundle,
};

if (require.main === module) main();
