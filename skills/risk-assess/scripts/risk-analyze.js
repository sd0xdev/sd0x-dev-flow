#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runCapture, gitRepoRoot, gitShortHead, qualifyCommand } = require('../../../scripts/lib/utils');

// ---------------------------------------------------------------------------
// File classification config (language-agnostic)
// ---------------------------------------------------------------------------
function loadClassification() {
  try {
    const p = path.join(__dirname, '../../../scripts/config/file-classification.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
const CLASSIFICATION = loadClassification();
const CODE_EXTS = CLASSIFICATION?.code_extensions ?? ['.ts', '.tsx', '.js', '.jsx'];
const IGNORE_PREFIXES = CLASSIFICATION?.ignore_prefixes ?? [
  'node_modules/', 'vendor/', 'dist/', 'build/', 'out/',
  'target/', '.next/', '.nuxt/', '__pycache__/', '.pytest_cache/',
  'venv/', '.venv/', '.git/',
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const MODE = argVal('--mode') || 'fast';
const FORMAT = process.argv.includes('--markdown') ? 'markdown' : 'json';
const BASE = argVal('--base') || 'HEAD';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isCodeFile(filePath) {
  const ext = path.extname(filePath);
  return CODE_EXTS.includes(ext);
}

function isIgnored(filePath) {
  return IGNORE_PREFIXES.some(p => filePath.startsWith(p));
}

function band(value, bands) {
  for (const [threshold, score] of bands) {
    if (value <= threshold) return score;
  }
  return bands[bands.length - 1][1];
}

// ---------------------------------------------------------------------------
// Data collection: collectDiff
// ---------------------------------------------------------------------------
async function collectDiff(root, base) {
  // Validate base ref exists
  const refCheck = await runCapture('git', ['rev-parse', '--verify', base], { cwd: root });
  if (refCheck.code !== 0) {
    console.error(`Invalid base ref: ${base}`);
    process.exit(2);
  }

  const [diffRaw, numstatRaw, nameStatusRaw, renameRaw, porcelainRaw] = await Promise.all([
    runCapture('git', ['diff', base, '--no-color', '--unified=3'], { cwd: root }),
    runCapture('git', ['diff', base, '--numstat'], { cwd: root }),
    runCapture('git', ['diff', base, '--name-status'], { cwd: root }),
    runCapture('git', ['diff', base, '--diff-filter=R', '--name-status'], { cwd: root }),
    runCapture('git', ['status', '--porcelain'], { cwd: root }),
  ]);

  // Parse hunks from full diff
  const hunks = parseDiffHunks(diffRaw.stdout || '');

  // Parse numstat for file-level stats
  const stats = parseNumstat(numstatRaw.stdout || '');

  // Parse name-status for file statuses
  const files = parseNameStatus(nameStatusRaw.stdout || '');

  // Include untracked files from porcelain (??)
  const seenFiles = new Set(files.map(f => f.file));
  for (const line of (porcelainRaw.stdout || '').split('\n')) {
    if (!line.startsWith('??')) continue;
    const filePath = line.slice(3).trim();
    if (!filePath || seenFiles.has(filePath)) continue;
    // Untracked directories end with / — expand via readdirSync
    if (filePath.endsWith('/')) {
      expandUntrackedDir(root, filePath, files, stats, seenFiles);
    } else {
      files.push({ status: 'A', file: filePath });
      seenFiles.add(filePath);
      // Estimate LOC for untracked files (skip large/binary files)
      try {
        const fstat = fs.statSync(path.join(root, filePath));
        if (fstat.size < 1_048_576) { // 1 MB cap
          const content = fs.readFileSync(path.join(root, filePath), 'utf8');
          const lineCount = content.split('\n').length;
          stats.push({ file: filePath, added: lineCount, deleted: 0 });
        }
      } catch { /* skip */ }
    }
  }

  // Parse renames
  const renames = parseRenames(renameRaw.stdout || '');

  return { hunks, stats, files, renames, diffText: diffRaw.stdout || '' };
}

function expandUntrackedDir(root, dirPath, files, stats, seenFiles) {
  try {
    const entries = fs.readdirSync(path.join(root, dirPath), { withFileTypes: true });
    for (const entry of entries) {
      const rel = dirPath + entry.name;
      if (isIgnored(rel)) continue;
      if (entry.isDirectory()) {
        expandUntrackedDir(root, rel + '/', files, stats, seenFiles);
      } else if (!seenFiles.has(rel)) {
        files.push({ status: 'A', file: rel });
        seenFiles.add(rel);
        try {
          const fstat = fs.statSync(path.join(root, rel));
          if (fstat.size < 1_048_576) { // 1 MB cap
            const content = fs.readFileSync(path.join(root, rel), 'utf8');
            const lineCount = content.split('\n').length;
            stats.push({ file: rel, added: lineCount, deleted: 0 });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
}

function parseDiffHunks(diffText) {
  const hunks = [];
  const fileHeaderRe = /^diff --git a\/(.+?) b\/(.+)$/;
  let currentFile = null;
  let currentHunk = null;

  for (const line of diffText.split('\n')) {
    const fileMatch = line.match(fileHeaderRe);
    if (fileMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentFile = fileMatch[2];
      currentHunk = null;
      continue;
    }
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { file: currentFile, removed: [], added: [] };
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.removed.push(line.slice(1));
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.added.push(line.slice(1));
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

function parseNumstat(text) {
  const stats = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
    const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
    stats.push({ file: parts[2], added, deleted });
  }
  return stats;
}

function parseNameStatus(text) {
  const files = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // Handle renames: R100\told\tnew
    const renameMatch = line.match(/^([RC]\d*)\t([^\t]+)\t(.+)$/);
    if (renameMatch) {
      files.push({ status: 'R', oldFile: renameMatch[2], file: renameMatch[3] });
      continue;
    }
    const m = line.match(/^([AMD])\t(.+)$/);
    if (!m) continue;
    files.push({ status: m[1], file: m[2] });
  }
  return files;
}

function parseRenames(text) {
  const renames = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^R\d*\t([^\t]+)\t(.+)$/);
    if (m) renames.push({ from: m[1], to: m[2] });
  }
  return renames;
}

// ---------------------------------------------------------------------------
// Dimension 1: breaking_surface (weight 45%)
// ---------------------------------------------------------------------------
function scoreBreakingSurface(hunks, files) {
  const signals = [];

  for (const hunk of hunks) {
    const file = hunk.file;
    if (!file) continue;

    // export-removed: -export without corresponding +export
    const removedExports = hunk.removed.filter(l =>
      /^\s*export\s+(function|const|class|default|let|var|type|interface|enum)\b/.test(l)
    );
    const addedExports = hunk.added.filter(l =>
      /^\s*export\s+(function|const|class|default|let|var|type|interface|enum)\b/.test(l)
    );

    for (const rem of removedExports) {
      const nameMatch = rem.match(/export\s+(?:function|const|class|let|var|type|interface|enum)\s+(\w+)/);
      const removedName = nameMatch ? nameMatch[1] : null;

      // Check if this export name was re-added (possibly renamed)
      const wasReAdded = removedName && addedExports.some(a => a.includes(removedName));

      if (!wasReAdded) {
        // Check if it's a rename (different name in added exports)
        if (removedName && addedExports.length > 0) {
          signals.push({ type: 'export-renamed', file, detail: `Export '${removedName}' renamed`, weight: 10 });
        } else {
          signals.push({ type: 'export-removed', file, detail: `Export removed: ${rem.trim().slice(0, 80)}`, weight: 15 });
        }
      }
    }

    // signature-changed: same function name, different params (code files only)
    if (isCodeFile(file)) {
      const removedFns = extractFunctionSignatures(hunk.removed);
      const addedFns = extractFunctionSignatures(hunk.added);
      for (const [name, oldParams] of Object.entries(removedFns)) {
        if (addedFns[name] && addedFns[name] !== oldParams) {
          signals.push({ type: 'signature-changed', file, detail: `'${name}' params changed: (${oldParams}) -> (${addedFns[name]})`, weight: 10 });
        }
      }
    }

    // type-field-removed: field removed from interface/type
    const removedFields = hunk.removed.filter(l => /^\s+\w+\s*[?]?\s*:/.test(l));
    const addedFields = hunk.added.filter(l => /^\s+\w+\s*[?]?\s*:/.test(l));
    for (const rem of removedFields) {
      const fieldMatch = rem.match(/^\s+(\w+)\s*[?]?\s*:/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const wasReAdded = addedFields.some(a => {
          const am = a.match(/^\s+(\w+)\s*[?]?\s*:/);
          return am && am[1] === fieldName;
        });
        if (!wasReAdded) {
          signals.push({ type: 'type-field-removed', file, detail: `Field '${fieldName}' removed`, weight: 8 });
        }
      }
    }
  }

  // config-key-removed: keys removed from config files
  const configFiles = ['package.json', 'tsconfig.json', '.env', '.env.example'];
  for (const hunk of hunks) {
    if (!hunk.file) continue;
    const basename = path.basename(hunk.file);
    if (configFiles.includes(basename) || hunk.file.endsWith('.env')) {
      for (const rem of hunk.removed) {
        const keyMatch = rem.match(/^\s*"?(\w[\w.-]*)"?\s*[=:]/);
        if (keyMatch) {
          const key = keyMatch[1];
          const wasReAdded = hunk.added.some(a => a.includes(key));
          if (!wasReAdded) {
            signals.push({ type: 'config-key-removed', file: hunk.file, detail: `Config key '${key}' removed`, weight: 5 });
          }
        }
      }
    }
  }

  // module-deleted: entire file deleted that could have importers
  for (const f of files) {
    if (f.status === 'D' && isCodeFile(f.file) && !isIgnored(f.file)) {
      signals.push({ type: 'module-deleted', file: f.file, detail: `Module deleted: ${f.file}`, weight: 20 });
    }
  }

  const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));
  return { score, signals };
}

function extractFunctionSignatures(lines) {
  const sigs = {};
  for (const line of lines) {
    // Anchor to declaration forms: export/async/function/method definitions
    // Matches: function name(params), async function name(params), export function name(params)
    // Also matches: name(params) { — method/arrow-like declarations at start of line
    const m = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (m) {
      sigs[m[1]] = m[2].trim();
      continue;
    }
    // Also match method-style: name(params) { or name = (params) =>
    const methodMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[{:]/);
    if (methodMatch) {
      sigs[methodMatch[1]] = methodMatch[2].trim();
    }
  }
  return sigs;
}

// ---------------------------------------------------------------------------
// Dimension 2: blast_radius (weight 35%)
// ---------------------------------------------------------------------------
async function scoreBlastRadius(root, files) {
  const codeFiles = files.filter(f =>
    (f.status === 'M' || f.status === 'A' || f.status === 'D' || f.status === 'R') &&
    isCodeFile(f.file) && !isIgnored(f.file)
  );

  if (codeFiles.length === 0) {
    return { score: 0, dependents_total: 0, confidence: 'high', top_affected: [] };
  }

  let totalDependents = 0;
  const topAffected = [];

  // Check for dynamic imports once (not per-file)
  const dynR = await runCapture('grep', ['-Frl', '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx', '--', 'import(', '.'], { cwd: root });
  const hasDynamicImports = dynR.code === 0 && !!(dynR.stdout || '').trim();

  for (const cf of codeFiles) {
    const modulePath = deriveImportPath(cf.file);
    if (!modulePath) continue;

    const patterns = buildImportPatterns(modulePath);
    const depSet = new Set();

    for (const pattern of patterns) {
      const r = await runCapture('grep', ['-Frl', '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx', '--include=*.py', '--include=*.go', '--', pattern, '.'], { cwd: root });
      if (r.code === 0 && r.stdout.trim()) {
        for (const f of r.stdout.trim().split('\n')) {
          const rel = f.startsWith('./') ? f.slice(2) : f;
          if (rel !== cf.file && !isIgnored(rel)) {
            depSet.add(rel);
          }
        }
      }
    }

    const dependentCount = depSet.size;
    totalDependents += dependentCount;
    topAffected.push({ file: cf.file, dependent_count: dependentCount });
  }

  topAffected.sort((a, b) => b.dependent_count - a.dependent_count);

  const score = band(totalDependents, [
    [0, 0], [3, 15], [10, 35], [25, 60], [50, 80], [Infinity, 95],
  ]);

  let confidence = 'high';
  if (hasDynamicImports) confidence = 'low';
  else {
    // Check for monorepo indicators
    try {
      const lernaExists = fs.existsSync(path.join(root, 'lerna.json'));
      const pnpmWorkspace = fs.existsSync(path.join(root, 'pnpm-workspace.yaml'));
      if (lernaExists || pnpmWorkspace) confidence = 'medium';
    } catch { /* ignore */ }
  }

  return { score, dependents_total: totalDependents, confidence, top_affected: topAffected.slice(0, 10) };
}

function deriveImportPath(filePath) {
  // Strip extension and handle index files
  const ext = path.extname(filePath);
  let importPath = filePath.slice(0, -ext.length);
  if (importPath.endsWith('/index')) {
    importPath = importPath.slice(0, -'/index'.length);
  }
  return importPath;
}

function buildImportPatterns(modulePath) {
  const patterns = [];
  // JS/TS: from '...<module>' or require('...<module>')
  const basename = path.basename(modulePath);
  const dir = path.dirname(modulePath);
  // Match relative imports ending with this module
  patterns.push(basename);
  // Also match the full path for absolute-style imports
  if (dir !== '.') {
    patterns.push(modulePath);
  }
  return patterns;
}

// ---------------------------------------------------------------------------
// Dimension 3: change_scope (weight 20%)
// ---------------------------------------------------------------------------
function scoreChangeScope(stats, files, renames) {
  const fileCount = files.filter(f => !isIgnored(f.file)).length;
  const locDelta = stats.reduce((sum, s) => sum + s.added + s.deleted, 0);
  const dirs = new Set(files.filter(f => !isIgnored(f.file)).map(f => path.dirname(f.file)));
  const dirSpan = dirs.size;
  const renameCount = renames.length;
  const renameRatio = fileCount > 0 ? renameCount / fileCount : 0;

  // Sub-scores
  const fileCountScore = band(fileCount, [[3, 10], [10, 30], [25, 60], [Infinity, 90]]);
  const locDeltaScore = band(locDelta, [[50, 10], [200, 30], [500, 60], [Infinity, 90]]);
  const dirSpanScore = band(dirSpan, [[1, 0], [3, 20], [6, 50], [Infinity, 80]]);
  const renameRatioScore = renameRatio === 0 ? 0 : renameRatio < 0.3 ? 10 : renameRatio <= 0.7 ? 30 : 50;

  // Weighted: file_count(30) + loc_delta(30) + dir_span(20) + rename_ratio(20)
  const score = Math.round(
    (fileCountScore * 30 + locDeltaScore * 30 + dirSpanScore * 20 + renameRatioScore * 20) / 100
  );

  return {
    score,
    metrics: {
      file_count: fileCount,
      loc_delta: locDelta,
      dir_span: dirSpan,
      rename_ratio: Math.round(renameRatio * 100) / 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Conditional flags
// ---------------------------------------------------------------------------
function checkMigrationSafety(files) {
  const migrationPatterns = [/migration/i, /schema/i, /\.sql$/, /migrate/i];
  const migrationFiles = files.filter(f =>
    migrationPatterns.some(p => p.test(f.file))
  ).map(f => f.file);

  if (migrationFiles.length === 0) {
    return { triggered: false, has_rollback: false, files: [] };
  }

  // Check for rollback/down files
  const hasRollback = migrationFiles.some(f => /down|rollback|revert/i.test(f)) ||
    files.some(f => /down|rollback|revert/i.test(f.file) && migrationPatterns.some(p => p.test(f.file)));

  return { triggered: true, has_rollback: hasRollback, files: migrationFiles };
}

function checkRegressionHint() {
  return { triggered: false, message: 'v2: full history analysis' };
}

// ---------------------------------------------------------------------------
// Deep mode analysis
// ---------------------------------------------------------------------------
async function deepAnalysis(root, files, blastResult) {
  const hotspots = [];
  const churnSummary = {};
  let transitiveCount = 0;

  const codeFiles = files.filter(f => isCodeFile(f.file) && !isIgnored(f.file));

  for (const f of codeFiles.slice(0, 20)) {
    // File churn (last 90 days)
    const churnR = await runCapture('git', [
      'log', '--since=90 days ago', '--format=%H', '--', f.file,
    ], { cwd: root });
    const commits = churnR.code === 0 ? churnR.stdout.trim().split('\n').filter(Boolean).length : 0;
    churnSummary[f.file] = commits;

    // Hotspot: churn > 10 AND blast_radius > 5 dependents
    const blastEntry = blastResult.top_affected.find(t => t.file === f.file);
    const depCount = blastEntry ? blastEntry.dependent_count : 0;
    if (commits > 10 && depCount > 5) {
      hotspots.push({ file: f.file, churn_90d: commits, dependents: depCount });
    }

    // Transitive dependents (2nd-level)
    if (blastEntry && blastEntry.dependent_count > 0) {
      const modulePath = deriveImportPath(f.file);
      if (modulePath) {
        const basename = path.basename(modulePath);
        const r = await runCapture('grep', ['-Frl', '--include=*.ts', '--include=*.js', '--', basename, '.'], { cwd: root });
        if (r.code === 0 && r.stdout.trim()) {
          const transitives = r.stdout.trim().split('\n').filter(Boolean);
          transitiveCount += Math.max(0, transitives.length - blastEntry.dependent_count - 1);
        }
      }
    }
  }

  return {
    hotspots,
    transitive_count: transitiveCount,
    churn_summary: churnSummary,
  };
}

// ---------------------------------------------------------------------------
// Overall score + risk level + gate
// ---------------------------------------------------------------------------
function computeOverall(breakingSurface, blastRadius, changeScope) {
  return Math.round(
    breakingSurface.score * 0.45 +
    blastRadius.score * 0.35 +
    changeScope.score * 0.20
  );
}

function riskLevel(score) {
  if (score < 30) return 'Low';
  if (score < 50) return 'Medium';
  if (score < 75) return 'High';
  return 'Critical';
}

function gate(level) {
  if (level === 'Low' || level === 'Medium') return 'PASS';
  if (level === 'High') return 'REVIEW';
  return 'BLOCK';
}

function exitCode(level) {
  if (level === 'Low' || level === 'Medium') return 0;
  if (level === 'High') return 1;
  return 2;
}

function buildNextActions(level, breakingSurface, blastRadius, migrationSafety) {
  const actions = [];

  if (level === 'High' || level === 'Critical') {
    actions.push({
      action: 'Run deep mode for full analysis',
      command: qualifyCommand('/risk-assess') + ' --mode deep',
      reason: `Risk level is ${level} — deep analysis recommended`,
    });
  }

  if (breakingSurface.score >= 50) {
    actions.push({
      action: 'Review breaking changes',
      command: qualifyCommand('/codex-review-fast'),
      reason: `${breakingSurface.signals.length} breaking change signals detected`,
    });
  }

  if (blastRadius.score >= 35) {
    actions.push({
      action: 'Verify dependent modules',
      command: null,
      reason: `${blastRadius.dependents_total} dependent files may be affected`,
    });
  }

  if (migrationSafety.triggered && !migrationSafety.has_rollback) {
    actions.push({
      action: 'Add migration rollback',
      command: null,
      reason: 'Migration files detected without rollback/down script',
    });
  }

  if (level === 'Critical') {
    actions.push({
      action: 'Consider splitting into smaller PRs',
      command: null,
      reason: 'Critical risk level — smaller changes reduce blast radius',
    });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Output builders
// ---------------------------------------------------------------------------
function buildOutput(root, branch, head, breakingSurface, blastRadius, changeScope, migrationSafety, regressionHint, deepResult, mode, base) {
  const overall = computeOverall(breakingSurface, blastRadius, changeScope);
  const level = riskLevel(overall);

  return {
    version: 1,
    repo: path.basename(root),
    branch,
    head,
    mode,
    base,
    overall_score: overall,
    risk_level: level,
    dimensions: {
      breaking_surface: {
        score: breakingSurface.score,
        weight: 45,
        signals: breakingSurface.signals.map(s => ({ type: s.type, file: s.file, detail: s.detail })),
      },
      blast_radius: {
        score: blastRadius.score,
        weight: 35,
        dependents_total: blastRadius.dependents_total,
        confidence: blastRadius.confidence,
        top_affected: blastRadius.top_affected,
      },
      change_scope: {
        score: changeScope.score,
        weight: 20,
        metrics: changeScope.metrics,
      },
    },
    flags: {
      migration_safety: migrationSafety,
      regression_hint: regressionHint,
    },
    deep_analysis: deepResult,
    gate: gate(level),
    next_actions: buildNextActions(level, breakingSurface, blastRadius, migrationSafety),
  };
}

function formatMarkdown(output) {
  const lines = [];
  const icon = output.risk_level === 'Low' ? '🟢' : output.risk_level === 'Medium' ? '🟡' : output.risk_level === 'High' ? '🟠' : '🔴';

  lines.push('## Risk Assessment Report');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Repo | ${output.repo} |`);
  lines.push(`| Branch | ${output.branch} |`);
  lines.push(`| Head | ${output.head} |`);
  lines.push(`| Mode | ${output.mode} |`);
  lines.push(`| Base | ${output.base} |`);
  lines.push(`| Score | **${output.overall_score}/100** |`);
  lines.push(`| Risk Level | ${icon} ${output.risk_level} |`);
  lines.push(`| Gate | ${output.gate} |`);
  lines.push('');

  // Dimensions
  lines.push('### Dimensions');
  lines.push('');
  lines.push('| Dimension | Score | Weight |');
  lines.push('|-----------|-------|--------|');
  lines.push(`| Breaking Surface | ${output.dimensions.breaking_surface.score}/100 | ${output.dimensions.breaking_surface.weight}% |`);
  lines.push(`| Blast Radius | ${output.dimensions.blast_radius.score}/100 | ${output.dimensions.blast_radius.weight}% |`);
  lines.push(`| Change Scope | ${output.dimensions.change_scope.score}/100 | ${output.dimensions.change_scope.weight}% |`);
  lines.push('');

  // Breaking surface signals
  if (output.dimensions.breaking_surface.signals.length > 0) {
    lines.push('### Breaking Change Signals');
    lines.push('');
    for (const s of output.dimensions.breaking_surface.signals) {
      lines.push(`- **${s.type}** in \`${s.file}\`: ${s.detail}`);
    }
    lines.push('');
  }

  // Blast radius top affected
  if (output.dimensions.blast_radius.top_affected.length > 0) {
    lines.push('### Top Affected Files');
    lines.push('');
    lines.push('| File | Dependents |');
    lines.push('|------|-----------|');
    for (const t of output.dimensions.blast_radius.top_affected.slice(0, 5)) {
      lines.push(`| ${t.file} | ${t.dependent_count} |`);
    }
    lines.push('');
    lines.push(`Confidence: ${output.dimensions.blast_radius.confidence}`);
    lines.push('');
  }

  // Change scope metrics
  lines.push('### Change Scope');
  lines.push('');
  const m = output.dimensions.change_scope.metrics;
  lines.push(`- Files: ${m.file_count}`);
  lines.push(`- LOC delta: ${m.loc_delta}`);
  lines.push(`- Directory span: ${m.dir_span}`);
  lines.push(`- Rename ratio: ${Math.round(m.rename_ratio * 100)}%`);
  lines.push('');

  // Flags
  if (output.flags.migration_safety.triggered) {
    lines.push('### Migration Safety');
    lines.push('');
    lines.push(`- Rollback: ${output.flags.migration_safety.has_rollback ? '✅ Found' : '❌ Missing'}`);
    lines.push(`- Files: ${output.flags.migration_safety.files.join(', ')}`);
    lines.push('');
  }

  // Deep analysis
  if (output.deep_analysis) {
    lines.push('### Deep Analysis');
    lines.push('');
    if (output.deep_analysis.hotspots.length > 0) {
      lines.push('**Hotspots** (high churn + high blast radius):');
      for (const h of output.deep_analysis.hotspots) {
        lines.push(`- \`${h.file}\`: ${h.churn_90d} commits (90d), ${h.dependents} dependents`);
      }
      lines.push('');
    }
    lines.push(`Transitive dependents: ${output.deep_analysis.transitive_count}`);
    lines.push('');
  }

  // Next actions
  if (output.next_actions.length > 0) {
    lines.push('### Next Actions');
    lines.push('');
    for (const a of output.next_actions) {
      const cmd = a.command ? `\`${a.command}\`` : '(manual)';
      lines.push(`- ${cmd} — ${a.reason}`);
    }
    lines.push('');
  }

  // Gate sentinel
  if (output.gate === 'PASS') {
    lines.push('## Gate: ✅');
  } else if (output.gate === 'REVIEW') {
    lines.push('## Gate: ⚠️');
  } else {
    lines.push('## Gate: ⛔');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const root = await gitRepoRoot();
  if (!root) {
    console.error('Not in a git repository.');
    process.exit(2);
  }

  // Get branch info
  const branchR = await runCapture('git', ['branch', '--show-current'], { cwd: root });
  const branch = (branchR.stdout || '').trim() || 'detached';
  const head = await gitShortHead(root) || 'unknown';

  // Collect diff data
  const diff = await collectDiff(root, BASE);

  if (diff.files.length === 0) {
    // No changes
    const output = {
      version: 1,
      repo: path.basename(root),
      branch,
      head,
      mode: MODE,
      base: BASE,
      overall_score: 0,
      risk_level: 'Low',
      dimensions: {
        breaking_surface: { score: 0, weight: 45, signals: [] },
        blast_radius: { score: 0, weight: 35, dependents_total: 0, confidence: 'high', top_affected: [] },
        change_scope: { score: 0, weight: 20, metrics: { file_count: 0, loc_delta: 0, dir_span: 0, rename_ratio: 0 } },
      },
      flags: {
        migration_safety: { triggered: false, has_rollback: false, files: [] },
        regression_hint: { triggered: false, message: 'v2: full history analysis' },
      },
      deep_analysis: null,
      gate: 'PASS',
      next_actions: [],
    };
    if (FORMAT === 'markdown') {
      console.log(formatMarkdown(output));
    } else {
      console.log(JSON.stringify(output, null, 2));
    }
    process.exit(0);
  }

  // Score dimensions
  const breakingSurface = scoreBreakingSurface(diff.hunks, diff.files);
  const blastRadius = await scoreBlastRadius(root, diff.files);
  const changeScope = scoreChangeScope(diff.stats, diff.files, diff.renames);

  // Conditional flags
  const migrationSafety = checkMigrationSafety(diff.files);
  const regressionHint = checkRegressionHint();

  // Deep mode
  let deepResult = null;
  if (MODE === 'deep') {
    deepResult = await deepAnalysis(root, diff.files, blastRadius);
  }

  // Build output
  const output = buildOutput(
    root, branch, head,
    breakingSurface, blastRadius, changeScope,
    migrationSafety, regressionHint, deepResult,
    MODE, BASE
  );

  if (FORMAT === 'markdown') {
    console.log(formatMarkdown(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  process.exit(exitCode(output.risk_level));
}

main().catch(err => {
  console.error('risk-analyze.js error:', err.message);
  process.exit(2);
});
