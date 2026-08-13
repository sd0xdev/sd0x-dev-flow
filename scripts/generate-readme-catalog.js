#!/usr/bin/env node
/**
 * generate-readme-catalog.js
 *
 * Reads docs/skill-catalog.yml + each skills SKILL.md frontmatter and generates
 * README.md blocks between comment markers. Replaces hero count, install
 * coverage, what's-included count, essential skills table, and full catalog.
 *
 * Usage:
 *   node scripts/generate-readme-catalog.js           # Update README.md
 *   node scripts/generate-readme-catalog.js --dry-run  # Print diff, don't write
 *   node scripts/generate-readme-catalog.js --check    # Exit 1 if README would change
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'docs', 'skill-catalog.yml');
const README_PATH = path.join(ROOT, 'README.md');
const SKILLS_DIR = path.join(ROOT, 'skills');

// ── Helpers ──────────────────────────────────────────────

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// ── Lightweight YAML parser (flat structure only) ────────

function parseCatalogYaml(text) {
  const result = { version: 1, categories: [], skills: [] };
  let current = null; // 'categories' | 'skills'
  let item = null;

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();

    if (line.startsWith('version:')) {
      result.version = parseInt(line.split(':')[1].trim(), 10);
      continue;
    }
    if (line === 'categories:') {
      if (item && current) result[current].push(item);
      item = null;
      current = 'categories';
      continue;
    }
    if (line === 'skills:') {
      if (item && current) result[current].push(item);
      item = null;
      current = 'skills';
      continue;
    }
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // New item
    if (/^\s{2}- /.test(line)) {
      if (item && current) result[current].push(item);
      item = {};
      const kv = line.replace(/^\s{2}- /, '');
      parseKV(item, kv);
      continue;
    }

    // Continuation field
    if (/^\s{4}\w/.test(line) && item) {
      parseKV(item, line.trim());
      continue;
    }
  }
  if (item && current) result[current].push(item);
  return result;
}

function parseKV(obj, text) {
  const m = text.match(/^(\w[\w_-]*):\s*(.*)/);
  if (!m) return;
  const [, key, raw] = m;
  let val = raw.replace(/^"/, '').replace(/"$/, '').trim();
  if (val === 'true') val = true;
  else if (val === 'false') val = false;
  obj[key] = val;
}

// ── Load SKILL.md descriptions ──────────────────────────

function loadSkillDescriptions() {
  const descs = {};
  const dirs = fs.readdirSync(SKILLS_DIR).filter(d =>
    fs.statSync(path.join(SKILLS_DIR, d)).isDirectory()
  );
  for (const dir of dirs) {
    const content = readText(path.join(SKILLS_DIR, dir, 'SKILL.md'));
    if (!content) continue;
    const fm = content.match(/^---\n([\s\S]+?)\n---/);
    if (!fm) continue;
    const descLine = fm[1].split('\n').find(l => l.startsWith('description:'));
    if (!descLine) continue;
    let desc = descLine.replace(/^description:\s*"?/, '').replace(/"?\s*$/, '');
    // Truncate to first sentence for README display
    const dotIdx = desc.indexOf('. ');
    if (dotIdx > 0 && dotIdx < 120) desc = desc.slice(0, dotIdx + 1);
    else if (desc.length > 120) desc = desc.slice(0, 117) + '...';
    descs[dir] = desc;
  }
  return descs;
}

// ── Validation ──────────────────────────────────────────

function validate(catalog, descriptions) {
  const warnings = [];
  const catalogCommands = new Set(catalog.skills.map(s => s.command.replace(/^\//, '')));
  // Enumerate directories separately — skills without SKILL.md or description are still detected
  const allDirs = new Set(
    fs.readdirSync(SKILLS_DIR).filter(d => fs.statSync(path.join(SKILLS_DIR, d)).isDirectory())
  );
  const validCategories = new Set(catalog.categories.map(c => c.id));

  for (const dir of allDirs) {
    if (!catalogCommands.has(dir)) {
      warnings.push(`⚠️  Skill not in catalog: ${dir}`);
    }
  }
  for (const skill of catalog.skills) {
    const name = skill.command.replace(/^\//, '');
    if (!allDirs.has(name)) {
      warnings.push(`⚠️  Catalog entry for missing skill: ${skill.command}`);
    }
    if (!validCategories.has(skill.category)) {
      warnings.push(`⚠️  Invalid category "${skill.category}" for ${skill.command}`);
    }
    if (skill.featured && !skill.use_when) {
      warnings.push(`⚠️  Featured skill missing use_when: ${skill.command}`);
    }
  }
  return warnings;
}

// ── Block builders ──────────────────────────────────────

function getPublicSkills(catalog) {
  return catalog.skills.filter(s => s.public !== false);
}

function getDescription(skill, descriptions) {
  if (skill.description) return skill.description;
  const name = skill.command.replace(/^\//, '');
  return descriptions[name] || skill.command;
}

// Count on-disk assets so the "What's included" table can never drift from
// reality (the 5 locale READMEs once carried a stale "9 hooks / 13 scripts").
// Examples stay hand-curated; only the numeric counts are derived here.
function diskCounts() {
  const countExt = (dir, exts) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(ROOT, dir));
    } catch {
      return 0;
    }
    return entries.filter(f => exts.some(e => f.endsWith(e))).length;
  };
  return {
    hooks: countExt('hooks', ['.sh']),
    scripts: countExt('scripts', ['.sh', '.js']),
    agents: countExt('agents', ['.md']),
    rules: countExt('rules', ['.md']),
  };
}

function buildHeroCount({ publicCount, bundledCount, disk }) {
  return `${bundledCount} bundled · ${publicCount} public skills · ${disk.agents} agents — ~4% of Claude's context window`;
}

function buildWhatsIncludedCount({ publicCount, bundledCount, disk }) {
  // Full table (header+separator+all rows) to avoid HTML comment breaking table
  return [
    '| Category | Count | Examples |',
    '|----------|-------|---------|',
    `| Skills | ${publicCount} public (${bundledCount} bundled) | \`/project-setup\`, \`/codex-review-fast\`, \`/verify\`, \`/smart-commit\`, \`/deep-research\` |`,
    `| Agents | ${disk.agents} | strict-reviewer, verify-app, coverage-analyst, architecture-designer |`,
    `| Hooks | ${disk.hooks} | pre-edit-guard, auto-format, review state tracking, stop guard, post-compact-auto-loop, post-skill-auto-loop, user-prompt-review-guard, session-init |`,
    `| Rules | ${disk.rules} | auto-loop, auto-loop-project, codex-invocation, security, testing, git-workflow, self-improvement, context-management |`,
    `| Scripts | ${disk.scripts} | precommit runner, verify runner, dep audit, namespace hint, skill runner, commit-msg guard, pre-push gate, emit-review-gate, emit-plan-gate, build-codex-artifacts, resolve-feature (node entrypoint + shell shim + CLI), classify-docs, detect-scope, migration-audit, security-redact, readme-catalog, check-doc-links, resolve-review-profile, dispatch-log CLI |`,
  ].join('\n');
}

function buildInstallCoverage({ publicCount, bundledCount }) {
  // Full table (header+separator+all rows) to avoid HTML comment breaking table
  return [
    '| Method | Tools | Coverage |',
    '|--------|-------|----------|',
    `| Plugin install | Claude Code | Full (${bundledCount} bundled skills, hooks, rules, auto-loop) |`,
    `| \`npx skills add\` | Codex CLI, Cursor, Windsurf, Aider | Skills only (${publicCount} public skills) |`,
    '| `/codex-setup init` | Codex CLI | AGENTS.md kernel + git hooks |',
  ].join('\n');
}

function buildEssentialSkills(catalog) {
  const featured = catalog.skills.filter(s => s.featured && s.public !== false);
  const lines = [
    '| Skill | Use when |',
    '|-------|----------|',
  ];
  for (const s of featured) {
    lines.push(`| \`${s.command}\` | ${s.use_when || ''} |`);
  }
  return lines.join('\n');
}

function buildFullCatalog(catalog, descriptions) {
  const publicSkills = getPublicSkills(catalog);
  const count = publicSkills.length;
  const sortedCategories = [...catalog.categories].sort((a, b) => a.order - b.order);

  const lines = ['<details>', `<summary>All ${count} public skills</summary>`, ''];

  for (const cat of sortedCategories) {
    const skills = publicSkills
      .filter(s => s.category === cat.id)
      .sort((a, b) => a.command.localeCompare(b.command));

    if (skills.length === 0) continue;

    lines.push(`### ${cat.label} (${skills.length})`, '');

    if (cat.id === 'review') {
      // Review category: 3-column with Loop Support
      lines.push('| Skill | Description | Loop Support |');
      lines.push('|-------|-------------|--------------|');
      for (const s of skills) {
        const desc = getDescription(s, descriptions);
        const loop = s.loop_support ? `\`${s.loop_support}\`` : '-';
        lines.push(`| \`${s.command}\` | ${desc} | ${loop} |`);
      }
    } else {
      // Standard: 2-column
      lines.push('| Skill | Description |');
      lines.push('|-------|-------------|');
      for (const s of skills) {
        const desc = getDescription(s, descriptions);
        lines.push(`| \`${s.command}\` | ${desc} |`);
      }
    }
    lines.push('');
  }

  lines.push('</details>');
  return lines.join('\n');
}

// ── Marker replacement ──────────────────────────────────

function replaceMarker(content, key, newBlock) {
  const re = new RegExp(
    `(<!-- BEGIN:${key} -->)\\n[\\s\\S]*?\\n(<!-- END:${key} -->)`,
    'g'
  );
  if (!re.test(content)) return { content, replaced: false };
  return {
    content: content.replace(re, `$1\n${newBlock}\n$2`),
    replaced: true,
  };
}

// ── Main ────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const check = args.includes('--check');

  // Load
  const yamlText = readText(CATALOG_PATH);
  if (!yamlText) {
    process.stderr.write(`Error: Cannot read ${CATALOG_PATH}\n`);
    process.exit(1);
  }

  const catalog = parseCatalogYaml(yamlText);
  const descriptions = loadSkillDescriptions();
  const warnings = validate(catalog, descriptions);

  for (const w of warnings) process.stderr.write(w + '\n');

  const publicSkills = getPublicSkills(catalog);
  const publicCount = publicSkills.length;
  // Count tracked + untracked-but-not-ignored skill dirs (what ships to plugin
  // users once the worktree is committed). --others --exclude-standard keeps
  // newly added (not yet staged) skills in the count while still excluding
  // gitignored junk dirs — otherwise the README undercounts in the window
  // between adding a skill and committing it, and ships stale after commit.
  // Falls back to filesystem when git is unavailable (e.g. unpacked tarball)
  // or when ls-files returns no entries (e.g. sparse checkout excluding skills/).
  // `git ls-files` always emits POSIX path separators, so `split('/')` is safe
  // even on Windows — do not "fix" this to use path.sep.
  let bundledCount = 0;
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', 'skills/'],
      { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const dirSet = new Set(
      out.split('\n').map(p => p.split('/')[1]).filter(Boolean)
    );
    bundledCount = dirSet.size;
  } catch {
    // Fall through to filesystem fallback below.
  }
  if (bundledCount === 0) {
    bundledCount = fs
      .readdirSync(SKILLS_DIR)
      .filter(d => {
        try {
          return fs.statSync(path.join(SKILLS_DIR, d)).isDirectory();
        } catch {
          return false;
        }
      }).length;
  }
  const counts = { publicCount, bundledCount, disk: diskCounts() };

  // Build blocks
  const blocks = {
    'HERO-COUNT': buildHeroCount(counts),
    'WHATS-INCLUDED-COUNT': buildWhatsIncludedCount(counts),
    'INSTALL-COVERAGE': buildInstallCoverage(counts),
    'ESSENTIAL-SKILLS': buildEssentialSkills(catalog),
    'FULL-CATALOG': buildFullCatalog(catalog, descriptions),
  };

  // Read README
  let readme = readText(README_PATH);
  if (!readme) {
    process.stderr.write(`Error: Cannot read ${README_PATH}\n`);
    process.exit(1);
  }

  const original = readme;
  const missing = [];

  for (const [key, block] of Object.entries(blocks)) {
    const result = replaceMarker(readme, key, block);
    if (!result.replaced) {
      missing.push(key);
    }
    readme = result.content;
  }

  if (missing.length > 0) {
    process.stderr.write(`⚠️  Missing markers in README.md: ${missing.join(', ')}\n`);
    process.stderr.write('   Add <!-- BEGIN:KEY --> / <!-- END:KEY --> markers first.\n');
    if (check) {
      process.stderr.write('Markers missing — cannot verify README is up to date.\n');
      process.exit(1);
    }
  }

  const changed = readme !== original;

  if (check) {
    if (changed) {
      process.stderr.write('README.md would be updated. Run without --check to apply.\n');
      process.exit(1);
    }
    process.stdout.write('README.md is up to date.\n');
    process.exit(0);
  }

  if (dryRun) {
    if (changed) {
      process.stdout.write('--- DRY RUN: README.md would be updated ---\n');
      process.stdout.write(`Skills: ${publicCount} public / ${bundledCount} bundled\n`);
      process.stdout.write(`Featured: ${catalog.skills.filter(s => s.featured).length}\n`);
      process.stdout.write(`Categories: ${catalog.categories.length}\n`);
      process.stdout.write(`Warnings: ${warnings.length}\n`);
    } else {
      process.stdout.write('No changes needed.\n');
    }
    process.exit(0);
  }

  if (changed) {
    fs.writeFileSync(README_PATH, readme, 'utf8');
    process.stdout.write(`✅ README.md updated: ${publicCount} public / ${bundledCount} bundled across ${catalog.categories.length} categories\n`);
  } else {
    process.stdout.write('No changes needed.\n');
  }
}

main();
