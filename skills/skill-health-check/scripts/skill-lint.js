#!/usr/bin/env node
'use strict';

/**
 * skill-lint.js — Automated skill health checker
 *
 * Validates all skills against routing, progressive loading, and structural criteria.
 *
 * Usage:
 *   node skill-lint.js [--skills-dir <path>] [--agents-dir <path>] [--json] [--fix-hint]
 *
 * Exit codes:
 *   0 = all pass
 *   1 = warnings only (P2)
 *   2 = errors found (P0/P1)
 */

const { readdirSync, readFileSync, existsSync, statSync } = require('node:fs');
const { join, basename, resolve } = require('node:path');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function argVal(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const jsonOutput = args.includes('--json');
const fixHint = args.includes('--fix-hint');

const cwd = process.cwd();
const skillsDir = resolve(argVal('--skills-dir', join(cwd, 'skills')));
const agentsDir = resolve(argVal('--agents-dir', join(cwd, 'agents')));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeContent(raw) {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    fm[key] = val;
  }
  return fm;
}

function bodyAfterFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : content;
}

function countLines(content) {
  return content.split('\n').length;
}

function hasHeading(body, pattern) {
  return new RegExp(`^##+ .*${pattern}`, 'im').test(body);
}

function similarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

// ---------------------------------------------------------------------------
// Check functions — each returns { pass, severity, message, fix? }
// ---------------------------------------------------------------------------

function checkFrontmatterExists(fm, skillName) {
  if (!fm) return { pass: false, severity: 'P0', message: 'Missing YAML frontmatter' };
  if (!fm.name)
    return { pass: false, severity: 'P0', message: 'Frontmatter missing `name` field' };
  if (!fm.description)
    return { pass: false, severity: 'P0', message: 'Frontmatter missing `description` field' };
  return { pass: true };
}

function checkRoutingSignature(fm) {
  if (!fm || !fm.description) return { pass: false, severity: 'P1', message: 'No description to check' };
  const desc = fm.description.toLowerCase();

  const hasUseCue =
    /\buse when\b/.test(desc) ||
    /\btrigger/.test(desc) ||
    /\buse for\b/.test(desc) ||
    /\buse this\b/.test(desc);
  const hasAvoidCue =
    /\bavoid\b/.test(desc) ||
    /\bnot for\b/.test(desc) ||
    /\bdon'?t use\b/.test(desc) ||
    /\binstead use\b/.test(desc);
  const hasOutputCue =
    /\boutput/.test(desc) ||
    /\bproduc/.test(desc) ||
    /\breport/.test(desc) ||
    /\bgenerat/.test(desc);

  const cueCount = [hasUseCue, hasAvoidCue, hasOutputCue].filter(Boolean).length;

  if (cueCount === 0) {
    return {
      pass: false,
      severity: 'P1',
      message: 'Description lacks routing cues (Use/Avoid/Output)',
      fix: 'Add routing cues: "Use when: X. Not for: Y. Output: Z."',
    };
  }
  if (cueCount < 2) {
    return {
      pass: false,
      severity: 'P2',
      message: `Description has ${cueCount}/3 routing cues (missing: ${!hasUseCue ? 'Use' : ''}${!hasAvoidCue ? ' Avoid' : ''}${!hasOutputCue ? ' Output' : ''})`.trim(),
      fix: 'Add missing routing cues to description',
    };
  }
  return { pass: true };
}

function checkWhenNotSection(body) {
  if (hasHeading(body, 'When NOT') || hasHeading(body, 'NOT to Use') || hasHeading(body, "Don't Use")) {
    return { pass: true };
  }
  return {
    pass: false,
    severity: 'P1',
    message: 'Missing "When NOT to Use" section in body',
    fix: 'Add ## When NOT to Use section',
  };
}

function checkOutputSection(body) {
  if (hasHeading(body, 'Output') || hasHeading(body, 'Deliverable') || hasHeading(body, 'Report')) {
    return { pass: true };
  }
  return {
    pass: false,
    severity: 'P2',
    message: 'Missing "Output" section defining expected deliverable format',
    fix: 'Add ## Output section with expected format',
  };
}

function checkVerificationSection(body) {
  if (hasHeading(body, 'Verification') || hasHeading(body, 'Checklist') || hasHeading(body, 'Gate')) {
    return { pass: true };
  }
  return {
    pass: false,
    severity: 'P2',
    message: 'Missing "Verification" section',
    fix: 'Add ## Verification section',
  };
}

function checkReferencesRouting(skillDir, body) {
  const refsDir = join(skillDir, 'references');
  if (!existsSync(refsDir) || !statSync(refsDir).isDirectory()) return { pass: true };

  const refFiles = readdirSync(refsDir).filter((f) => f.endsWith('.md'));
  if (refFiles.length === 0) return { pass: true };

  const missing = refFiles.filter((f) => !body.includes(f));
  if (missing.length === 0) return { pass: true };

  return {
    pass: false,
    severity: 'P2',
    message: `References not mentioned in SKILL.md: ${missing.join(', ')}`,
    fix: 'Add ## References section mapping when to read each file',
  };
}

function checkScriptsContract(skillDir, body) {
  const scriptsDir = join(skillDir, 'scripts');
  if (!existsSync(scriptsDir) || !statSync(scriptsDir).isDirectory()) return { pass: true };

  const scripts = readdirSync(scriptsDir).filter(
    (f) => f.endsWith('.js') || f.endsWith('.sh') || f.endsWith('.py')
  );
  if (scripts.length === 0) return { pass: true };

  const missing = scripts.filter((f) => !body.includes(f));
  if (missing.length === 0) return { pass: true };

  return {
    pass: false,
    severity: 'P2',
    message: `Scripts not documented in SKILL.md: ${missing.join(', ')}`,
    fix: 'Document each script with usage, inputs, outputs, and exit codes',
  };
}

function checkLineCount(content) {
  const lines = countLines(content);
  if (lines > 250) {
    return {
      pass: false,
      severity: 'P2',
      message: `SKILL.md is ${lines} lines (threshold: 250). Consider extracting to references/`,
    };
  }
  if (lines > 150) {
    return {
      pass: true,
      warning: `SKILL.md is ${lines} lines — review for extractable content`,
    };
  }
  return { pass: true };
}

// checkAllowedToolsSync removed (Phase B — skills-only architecture)

function checkAgentEntitlement(body, fm) {
  if (!fm) return { pass: true };
  // Only match explicit Agent( calls — subagent_type alone may be Task dispatch
  const mentions = /\bAgent\s*\(/.test(body);
  if (!mentions) return { pass: true };
  const tools = (fm['allowed-tools'] || '').replace(/^["']|["']$/g, '');
  if (/\bAgent\b/.test(tools)) return { pass: true };
  return {
    pass: false,
    severity: 'P2',
    message: 'Body describes Agent() dispatch but allowed-tools lacks Agent',
    fix: 'Add Agent to allowed-tools in SKILL.md',
  };
}

function checkTaskEntitlement(body, fm) {
  if (!fm) return { pass: true };
  const mentions = /\bTask\s*\(/.test(body) || /\bTaskCreate\b/.test(body);
  if (!mentions) return { pass: true };
  const tools = (fm['allowed-tools'] || '').replace(/^["']|["']$/g, '');
  if (/\bTask\b/.test(tools)) return { pass: true };
  return {
    pass: false,
    severity: 'P2',
    message: 'Body describes Task() dispatch but allowed-tools lacks Task',
    fix: 'Add Task to allowed-tools in SKILL.md',
  };
}

function checkSkillEntitlement(body, fm) {
  if (!fm) return { pass: true };
  // Match the call SYNTAX `Skill(` with NO space — a bare "/codex-review-doc" mention
  // in prose is ambiguous (may be a main-loop handoff, not an in-skill invocation), and
  // (critically) `Skill (` WITH a space is ordinary prose, not a call: e.g. a heading
  // like "# Codex Architect Skill (Third Brain)" would otherwise emit a false finding.
  // A real Skill() dispatch is always written `Skill("name")` with no intervening space.
  // SCOPE (deliberate): this checks only the call SYNTAX. A skill that describes dispatching
  // another skill in PROSE ("then invoke /foo") without the `Skill(` token is out of scope —
  // keying on bare skill-name mentions would false-fire on every handoff reference. Syntactic
  // dispatch is the enforceable signal; prose-only intent is left to review.
  //
  // DIVERGENCE FROM SIBLINGS, deliberate: the Agent/Task checks use `/\bAgent\s*\(/` and
  // `/\bTask\s*\(/`, tolerating whitespace before the paren. This one does NOT, and must not — a
  // heading such as `# Codex Architect Skill (Third Brain)` matches `\bSkill\s*\(` and emits a
  // false finding, which is exactly the regression the no-space form fixed. Do not "unify" these
  // three regexes on consistency grounds; the asymmetry is the fix.
  const mentions = /\bSkill\(/.test(body);
  if (!mentions) return { pass: true };
  const tools = (fm['allowed-tools'] || '').replace(/^["']|["']$/g, '');
  // TOKENIZED, not a word-boundary regex. `\bSkill\b` matched things that grant nothing of the
  // sort, because `(`, `-` and `:` are all non-word characters and therefore all supply the
  // boundary: `Bash(Skill:*)` is permission to run a shell COMMAND named `Skill`, and
  // `Some-Tool-Skill` is a different tool entirely. `allowed-tools` is a comma-separated list of
  // tool entries, so comparing whole entries is the check the format actually supports.
  // `Skill(...)` is accepted because a scoped entitlement still names this tool.
  const granted = tools
    .split(',')
    .map((t) => t.trim())
    .some((t) => t === 'Skill' || t.startsWith('Skill('));
  if (granted) return { pass: true };
  return {
    pass: false,
    severity: 'P2',
    message: 'Body describes Skill() dispatch but allowed-tools lacks Skill',
    fix: 'Add Skill to allowed-tools in SKILL.md',
  };
}

function checkCrossSkillRefPaths(skillName, skillDir, body) {
  // Same regex as skills-schema.test.js — group 1 captures @skills/<name>/ prefix
  const refPattern = /`?(@skills\/[^/]+\/)?@?(?:\.\/)?references\/([^`\s)]+\.md)`?/g;
  const mismatches = [];
  let match;

  while ((match = refPattern.exec(body)) !== null) {
    if (match[1]) continue; // Already using cross-skill path — OK

    const refFile = match[2];
    const localPath = join(skillDir, 'references', refFile);
    if (existsSync(localPath)) continue; // Exists locally — OK

    // Not local — check if it lives in another skill's references/
    const parentSkill = findRefInOtherSkills(refFile, skillName);
    if (parentSkill) {
      mismatches.push({ refFile, parentSkill });
    }
  }

  if (mismatches.length === 0) return { pass: true };

  const details = mismatches
    .map((m) => `references/${m.refFile} → @skills/${m.parentSkill}/references/${m.refFile}`)
    .join('; ');
  return {
    pass: false,
    severity: 'P1',
    message: `Non-local reference(s) need cross-skill path: ${details}`,
    fix: 'Use @skills/<parent>/references/<file>.md for cross-skill references',
  };
}

function findRefInOtherSkills(refFile, excludeSkill) {
  if (!isDir(skillsDir)) return null;
  const matches = [];
  for (const d of readdirSync(skillsDir)) {
    if (d === excludeSkill) continue;
    const p = join(skillsDir, d);
    if (!statSync(p).isDirectory()) continue;
    if (existsSync(join(p, 'references', refFile))) matches.push(d);
  }
  // Ambiguous if 2+ skills share the same filename — not clearly cross-skill
  return matches.length === 1 ? matches[0] : null;
}

// ---------------------------------------------------------------------------
// Skill-level checks
// ---------------------------------------------------------------------------

function lintSkill(skillName, skillDir) {
  const skillPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillPath)) {
    return { name: skillName, findings: [{ pass: false, severity: 'P0', message: 'SKILL.md not found' }] };
  }

  const raw = readFileSync(skillPath, 'utf8');
  const content = normalizeContent(raw);
  const fm = parseFrontmatter(content);
  const body = bodyAfterFrontmatter(content);
  const findings = [];

  findings.push({ check: 'frontmatter', ...checkFrontmatterExists(fm, skillName) });
  findings.push({ check: 'routing-signature', ...checkRoutingSignature(fm) });
  findings.push({ check: 'when-not', ...checkWhenNotSection(body) });
  findings.push({ check: 'output', ...checkOutputSection(body) });
  findings.push({ check: 'verification', ...checkVerificationSection(body) });
  findings.push({ check: 'references-routing', ...checkReferencesRouting(skillDir, body) });
  findings.push({ check: 'scripts-contract', ...checkScriptsContract(skillDir, body) });
  findings.push({ check: 'line-count', ...checkLineCount(content) });
  findings.push({ check: 'agent-entitlement', ...checkAgentEntitlement(body, fm) });
  findings.push({ check: 'task-entitlement', ...checkTaskEntitlement(body, fm) });
  findings.push({ check: 'skill-entitlement', ...checkSkillEntitlement(body, fm) });
  findings.push({ check: 'cross-skill-ref-path', ...checkCrossSkillRefPaths(skillName, skillDir, body) });

  return { name: skillName, path: skillPath, fm, body, findings };
}

// ---------------------------------------------------------------------------
// Cross-skill checks
// ---------------------------------------------------------------------------

function detectOrphans(skillNames) {
  // Orphan detection simplified (skills-only architecture)
  // CLAUDE.md coverage check handled by claude-md-coverage.test.js
  return [];
}

function detectDescriptionOverlap(skillResults) {
  const findings = [];
  const descs = skillResults
    .filter((r) => r.fm && r.fm.description)
    .map((r) => ({ name: r.name, desc: r.fm.description }));

  for (let i = 0; i < descs.length; i++) {
    for (let j = i + 1; j < descs.length; j++) {
      const sim = similarity(descs[i].desc, descs[j].desc);
      if (sim > 0.6) {
        findings.push({
          check: 'description-overlap',
          pass: false,
          severity: 'P2',
          message: `High description overlap (${(sim * 100).toFixed(0)}%) between "${descs[i].name}" and "${descs[j].name}"`,
          fix: 'Differentiate descriptions with distinct routing cues',
        });
      }
    }
  }
  return findings;
}

function detectMissingArgumentHints(skillNames) {
  // argument-hint check removed (Phase B — skills-only architecture)
  const argHintStatus = {};
  for (const skillName of skillNames) {
    argHintStatus[skillName] = null;
  }
  return { findings: [], argHintStatus };
}

function detectInvalidAgentRefs(skillResults, _agentsDir) {
  if (!isDir(_agentsDir)) return [];
  const knownAgents = new Set(
    readdirSync(_agentsDir).filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md'))
  );
  const BUILTINS = new Set(['Explore', 'general-purpose', 'Plan']);
  const findings = [];
  // Intentionally requires quotes — bare/backtick forms in markdown tables are not code dispatch
  const refPattern = /subagent_type[:\s]*["']([^"']+)["']/g;
  const seen = new Set();

  for (const result of skillResults) {
    if (!result.body) continue;
    for (const m of result.body.matchAll(refPattern)) {
      const name = m[1];
      if (BUILTINS.has(name) || name.includes(':') || knownAgents.has(name)) continue;
      const key = `${result.name}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        check: 'agent-ref-validity',
        pass: false,
        severity: 'P1',
        message: `subagent_type "${name}" not found in agents/ (skill: ${result.name})`,
        fix: `Create agents/${name}.md or fix the reference`,
      });
    }
  }

  return findings;
}

function detectAgentToolsSyntax(_agentsDir) {
  if (!isDir(_agentsDir)) return [];
  const CANONICAL_BARE = new Set([
    'Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'AskUserQuestion',
    'Agent', 'Task', 'Skill', 'WebSearch', 'WebFetch', 'NotebookEdit',
  ]);
  const SCOPED_RE = /^Bash\([a-z-]+:\*\)$/;
  const findings = [];
  for (const f of readdirSync(_agentsDir).filter((x) => x.endsWith('.md'))) {
    const content = normalizeContent(readFileSync(join(_agentsDir, f), 'utf8'));
    const fm = parseFrontmatter(content);
    if (!fm || !fm.tools) continue;
    const agentName = basename(f, '.md');
    const tools = String(fm.tools).split(/,\s*/);
    for (const t of tools) {
      const trimmed = t.trim();
      if (!trimmed) continue;
      if (CANONICAL_BARE.has(trimmed) || SCOPED_RE.test(trimmed)) continue;
      findings.push({
        check: 'agent-tools-syntax',
        pass: false,
        severity: 'P2',
        message: `Agent "${agentName}" has non-canonical tool: "${trimmed}"`,
        fix: 'Use canonical format: ToolName or Bash(<prefix>:*)',
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function isDir(p) {
  return existsSync(p) && statSync(p).isDirectory();
}

function main() {
  if (!isDir(skillsDir)) {
    console.error(`Skills directory not found or not a directory: ${skillsDir}`);
    process.exit(2);
  }

  const skillDirs = readdirSync(skillsDir).filter((d) => {
    const p = join(skillsDir, d);
    return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md'));
  });

  // Per-skill checks
  const skillResults = skillDirs.map((d) => lintSkill(d, join(skillsDir, d)));

  // Cross-skill checks
  const orphanFindings = detectOrphans(skillDirs);
  const overlapFindings = detectDescriptionOverlap(skillResults);
  const { findings: argHintFindings, argHintStatus } = detectMissingArgumentHints(skillDirs);
  const agentRefFindings = detectInvalidAgentRefs(skillResults, agentsDir);
  const agentToolsSyntaxFindings = detectAgentToolsSyntax(agentsDir);

  // Aggregate
  const allFindings = [];
  let p0Count = 0;
  let p1Count = 0;
  let p2Count = 0;
  let passCount = 0;
  let warnCount = 0;

  for (const result of skillResults) {
    for (const f of result.findings) {
      if (f.pass) {
        passCount++;
        if (f.warning) warnCount++;
      } else {
        allFindings.push({ skill: result.name, ...f });
        if (f.severity === 'P0') p0Count++;
        else if (f.severity === 'P1') p1Count++;
        else p2Count++;
      }
    }
  }

  for (const f of [...orphanFindings, ...overlapFindings, ...argHintFindings, ...agentRefFindings, ...agentToolsSyntaxFindings]) {
    allFindings.push({ skill: '(cross-skill)', ...f });
    if (f.severity === 'P0') p0Count++;
    else if (f.severity === 'P1') p1Count++;
    else p2Count++;
  }

  const overallPass = p0Count === 0 && p1Count === 0;
  const exitCode = p0Count > 0 || p1Count > 0 ? 2 : p2Count > 0 ? 1 : 0;

  // JSON output
  if (jsonOutput) {
    const report = {
      overallPass,
      stats: {
        skills: skillDirs.length,
        checks: passCount + allFindings.length,
        pass: passCount,
        warnings: warnCount,
        p0: p0Count,
        p1: p1Count,
        p2: p2Count,
      },
      findings: allFindings,
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exit(exitCode);
  }

  // Markdown output
  console.log('# Skill Health Check Report\n');
  console.log('## Summary\n');
  console.log(`| Metric | Value |`);
  console.log(`|--------|-------|`);
  console.log(`| Skills scanned | ${skillDirs.length} |`);
  console.log(`| Checks passed | ${passCount} |`);
  console.log(`| P0 (Must Fix) | ${p0Count} |`);
  console.log(`| P1 (Should Fix) | ${p1Count} |`);
  console.log(`| P2 (Suggestion) | ${p2Count} |`);
  console.log();

  // Per-skill summary
  console.log('## Per-Skill Results\n');
  console.log('| Skill | Routing | When-NOT | Output | Verification | Refs | AgEnt | TskEnt | Lines | Status |');
  console.log('|-------|---------|----------|--------|--------------|------|-------|--------|-------|--------|');
  for (const result of skillResults) {
    const get = (check) => {
      const f = result.findings.find((x) => x.check === check);
      if (!f) return '—';
      return f.pass ? '✅' : f.severity === 'P0' ? '🔴' : f.severity === 'P1' ? '🟡' : '⚪';
    };
    const lines = existsSync(result.path) ? countLines(readFileSync(result.path, 'utf8')) : 0;
    const issues = result.findings.filter((f) => !f.pass);
    const status = issues.length === 0 ? '✅' : issues.some((f) => f.severity === 'P0') ? '🔴' : issues.some((f) => f.severity === 'P1') ? '🟡' : '⚪';
    console.log(
      `| ${result.name} | ${get('routing-signature')} | ${get('when-not')} | ${get('output')} | ${get('verification')} | ${get('references-routing')} | ${get('agent-entitlement')} | ${get('task-entitlement')} | ${lines} | ${status} |`
    );
  }
  console.log();

  // Findings
  if (allFindings.length > 0) {
    const p0s = allFindings.filter((f) => f.severity === 'P0');
    const p1s = allFindings.filter((f) => f.severity === 'P1');
    const p2s = allFindings.filter((f) => f.severity === 'P2');

    if (p0s.length > 0) {
      console.log('## P0 (Must Fix)\n');
      for (const f of p0s) {
        console.log(`- **${f.skill}**: ${f.message}${fixHint && f.fix ? ` → ${f.fix}` : ''}`);
      }
      console.log();
    }
    if (p1s.length > 0) {
      console.log('## P1 (Should Fix)\n');
      for (const f of p1s) {
        console.log(`- **${f.skill}**: ${f.message}${fixHint && f.fix ? ` → ${f.fix}` : ''}`);
      }
      console.log();
    }
    if (p2s.length > 0) {
      console.log('## P2 (Suggestion)\n');
      for (const f of p2s) {
        console.log(`- **${f.skill}**: ${f.message}${fixHint && f.fix ? ` → ${f.fix}` : ''}`);
      }
      console.log();
    }
  }

  // Gate
  console.log(`## Gate: ${overallPass ? '✅ All Pass' : `⛔ ${p0Count + p1Count} issues need fixing`}`);

  process.exit(exitCode);
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    normalizeContent,
    parseFrontmatter,
    bodyAfterFrontmatter,
    checkAgentEntitlement,
    checkTaskEntitlement,
    checkSkillEntitlement,
    checkCrossSkillRefPaths,
    detectInvalidAgentRefs,
    detectAgentToolsSyntax,
  };
}
