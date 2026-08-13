#!/usr/bin/env node
'use strict';

/**
 * preflight.js — necessity-audit Phase 0 validation.
 *
 * Responsibilities (per 2-tech-spec.md §3.5 Phase 0):
 *   1. Path validation — realpath + relative containment + slug regex
 *   2. Feature resolver — repo-relative path input (feature-resolver.js Level-3)
 *   3. Doc-kind detection — 1-/2-/3-/4-*.md; 0-* only with --include-feasibility
 *   4. Line-count check — wc -l >= 50 or hard block
 *   5. State-read advisory — non-blocking; session-level hint only
 *   6. Dirty-tree warning — git status --porcelain check
 *   7. Greenfield detection — git grep with pathspec exclude + fallback
 *   8. Active dimensions — depth → {brief:[1,2,3], normal:[1..6], deep:[1..6]}
 *
 * CLI contract:
 *   node preflight.js --path <path> --depth <brief|normal|deep> [--skip-preflight] [--include-feasibility] --output <file>
 *
 * Exit codes:
 *   0 = OK
 *   1 = invalid path (traversal / symlink escape / bad slug)
 *   2 = target too short (< 50 lines)
 *   3 = invalid doc kind (not a lifecycle spec, or feasibility without flag)
 *   4 = feature unresolved
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { resolveFeatureContext } = require('../../lib/feature-resolver');

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

const DOC_KIND_RULES = [
  { pattern: /^0-feasibility-study(?:\/|\.md$)/, kind: 'feasibility', requiresFlag: 'include-feasibility' },
  { pattern: /^1-requirements\.md$/, kind: 'requirements' },
  { pattern: /^2-tech-spec\.md$/, kind: 'tech-spec' },
  { pattern: /^3-architecture\.md$/, kind: 'architecture' },
  { pattern: /^4-.+\.md$/, kind: 'implementation' },
];

const ACTIVE_DIMS_BY_DEPTH = {
  brief: [1, 2, 3],
  normal: [1, 2, 3, 4, 5, 6],
  deep: [1, 2, 3, 4, 5, 6],
};

const MIN_LINES = 50;

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function argFlag(flag) {
  return process.argv.indexOf(flag) > -1;
}

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function currentBranch(root) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function validatePath(rawPath, root) {
  let absPath;
  try {
    absPath = fs.realpathSync(path.resolve(root, rawPath));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error(`Target file not found: ${rawPath}`), { code: 1 });
    }
    throw err;
  }
  const rel = path.relative(root, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error(`Path escapes repo: ${rawPath}`), { code: 1 });
  }
  const featureMatch = rel.match(/^docs\/features\/([^/]+)\//);
  if (featureMatch && !SLUG_RE.test(featureMatch[1])) {
    throw Object.assign(new Error(`Invalid feature slug: ${featureMatch[1]}`), { code: 1 });
  }
  return { absPath, relPath: rel };
}

function detectDocKind(relPath, includeFeasibility) {
  const fileRelToFeature = relPath.replace(/^docs\/features\/[^/]+\//, '');
  for (const rule of DOC_KIND_RULES) {
    if (rule.pattern.test(fileRelToFeature)) {
      if (rule.requiresFlag === 'include-feasibility' && !includeFeasibility) {
        throw Object.assign(
          new Error(`0-feasibility-study is excluded by default. Use --include-feasibility to override.`),
          { code: 3 },
        );
      }
      return rule.kind;
    }
  }
  throw Object.assign(new Error(`Not a lifecycle spec: ${relPath}`), { code: 3 });
}

function countLines(absPath) {
  const content = fs.readFileSync(absPath, 'utf8');
  const matches = content.match(/\n/g);
  return matches ? matches.length : 0;
}

function readStateAdvisory(root) {
  // Advisory only. The verdict comes from the reminder-state checker (installed
  // copy first); its `passed` is content-addressed — bound to the current tree
  // digest — so the old last_run-vs-commit-time freshness math is gone with the
  // mirror file it compensated for. Checker absent → no claim, warn-side.
  let checker = path.join(root, '.claude', 'scripts', 'review-state.js');
  if (!fs.existsSync(checker)) checker = path.join(root, 'scripts', 'review-state.js');
  if (!fs.existsSync(checker)) return { recentPass: false, reason: 'no reminder-state checker' };
  try {
    const out = execFileSync('node', [checker, 'check', '--format=json'], { cwd: root, encoding: 'utf8' });
    const dr = JSON.parse(out).doc_review || {};
    if (dr.passed) return { recentPass: true };
    return { recentPass: false, reason: 'no doc_review pass bound to the current tree' };
  } catch {
    return { recentPass: false, reason: 'checker unreadable' };
  }
}

function dirtyTreeCheck(root, absPath) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', absPath], { cwd: root, encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectGreenfield(root, featureKey) {
  // Slug may contain '.' (per scripts/lib/feature-resolver.js slug regex); escape for -E regex mode
  const keyPattern = escapeRegex(featureKey);
  try {
    const out = execFileSync(
      'git',
      ['grep', '-l', '-E', keyPattern, '--', '.', ':(exclude)docs/**', ':(exclude)**/*.md'],
      { cwd: root, encoding: 'utf8' },
    );
    return out.trim().length === 0;
  } catch (err) {
    if (err.status === 1) return true;
    try {
      const out = execFileSync('git', ['grep', '-l', '-E', keyPattern, '--', '.'], { cwd: root, encoding: 'utf8' });
      const filtered = out.split('\n').filter(l => l && !l.startsWith('docs/') && !l.endsWith('.md'));
      return filtered.length === 0;
    } catch (err2) {
      if (err2.status === 1) return true;
      throw err2;
    }
  }
}

function main() {
  const rawPath = argVal('--path');
  const depth = argVal('--depth') || 'normal';
  const skipPreflight = argFlag('--skip-preflight');
  const includeFeasibility = argFlag('--include-feasibility');
  const outputFile = argVal('--output');

  if (!rawPath) {
    process.stderr.write('Missing --path\n');
    process.exit(1);
  }
  if (!ACTIVE_DIMS_BY_DEPTH[depth]) {
    process.stderr.write(`Invalid --depth: ${depth}\n`);
    process.exit(1);
  }
  if (!outputFile) {
    process.stderr.write('Missing --output\n');
    process.exit(1);
  }

  const root = repoRoot();
  const result = {
    skipPreflight,
    banners: [],
    warnings: [],
    activeDimensions: ACTIVE_DIMS_BY_DEPTH[depth],
    depth,
  };

  try {
    const { absPath, relPath } = validatePath(rawPath, root);
    result.absPath = absPath;
    result.relPath = relPath;

    result.docKind = detectDocKind(relPath, includeFeasibility);
    if (result.docKind === 'feasibility') result.banners.push('[OVERRIDE: feasibility included]');
    if (skipPreflight) result.banners.push('[PREFLIGHT SKIPPED]');

    const lines = countLines(absPath);
    if (lines < MIN_LINES) {
      process.stderr.write(`Target has ${lines} lines (< ${MIN_LINES} minimum)\n`);
      writeOutput(outputFile, { ...result, error: 'too short' });
      process.exit(2);
    }

    const featureMatch = relPath.match(/^docs\/features\/([^/]+)\//);
    if (!featureMatch) {
      process.stderr.write(`Cannot extract feature key from: ${relPath}\n`);
      writeOutput(outputFile, { ...result, error: 'no feature match' });
      process.exit(4);
    }
    const branch = currentBranch(root);
    const ctx = resolveFeatureContext(root, branch, [relPath], { featureKey: featureMatch[1] });
    if (!ctx.key) {
      process.stderr.write(`Feature unresolved: ${featureMatch[1]}\n`);
      writeOutput(outputFile, { ...result, error: 'feature unresolved' });
      process.exit(4);
    }
    result.featureKey = ctx.key;

    if (!skipPreflight) {
      const advisory = readStateAdvisory(root);
      if (!advisory.recentPass) {
        result.warnings.push(
          'ℹ️ No recent /codex-review-doc pass detected in this session. Recommend running /codex-review-doc first.',
        );
      }
    }

    if (dirtyTreeCheck(root, absPath)) {
      result.warnings.push('⚠️ Dirty working tree on target; necessity audit reflects uncommitted state');
    }

    result.greenfield = detectGreenfield(root, result.featureKey);

    writeOutput(outputFile, result);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    writeOutput(outputFile, { ...result, error: err.message });
    process.exit(err.code || 1);
  }
}

function writeOutput(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

if (require.main === module) main();

function assertLifecycleScope(preflight, root) {
  if (!preflight || typeof preflight.relPath !== 'string') {
    throw Object.assign(new Error('preflight missing relPath'), { code: 1 });
  }
  if (!/^docs\/features\/[^/]+\//.test(preflight.relPath)) {
    throw Object.assign(new Error(`preflight.relPath outside lifecycle scope: ${preflight.relPath}`), { code: 1 });
  }
  const { absPath, relPath } = validatePath(preflight.relPath, root);
  const actualKind = detectDocKind(relPath, preflight.docKind === 'feasibility');
  if (preflight.docKind && actualKind !== preflight.docKind) {
    throw Object.assign(
      new Error(`docKind mismatch: preflight says ${preflight.docKind}, relPath implies ${actualKind}`),
      { code: 3 },
    );
  }
  return { absPath, relPath };
}

module.exports = {
  DOC_KIND_RULES,
  ACTIVE_DIMS_BY_DEPTH,
  MIN_LINES,
  SLUG_RE,
  validatePath,
  detectDocKind,
  countLines,
  readStateAdvisory,
  dirtyTreeCheck,
  detectGreenfield,
  assertLifecycleScope,
};
