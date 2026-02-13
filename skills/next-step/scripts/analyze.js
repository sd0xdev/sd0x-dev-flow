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
    return null; // fallback to legacy patterns
  }
}
const CLASSIFICATION = loadClassification();

const CODE_EXTS = CLASSIFICATION?.code_extensions ?? ['.ts', '.tsx', '.js', '.jsx'];
const DOC_EXTS = CLASSIFICATION?.doc_extensions ?? ['.md', '.mdx'];
const IGNORE_PREFIXES = CLASSIFICATION?.ignore_prefixes ?? [];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const MAX_FINDINGS = Number(argVal('--max-findings')) || 8;
const FORMAT = process.argv.includes('--markdown') ? 'markdown' : 'json';
const FEATURE_KEY = argVal('--feature');

// Shared incomplete status taxonomy — used by request-stale, backlog, feature-complete
const INCOMPLETE_STATUSES = ['pending', 'in development', 'in progress', 'nearly complete'];

// ---------------------------------------------------------------------------
// Input collection (4 git commands + 1 file read)
// ---------------------------------------------------------------------------
async function collectInputs(root) {
  const [nameStatus, porcelain, branch, diffStat] = await Promise.all([
    runCapture('git', ['diff', '--name-status', 'HEAD'], { cwd: root }),
    runCapture('git', ['status', '--porcelain'], { cwd: root }),
    runCapture('git', ['branch', '--show-current'], { cwd: root }),
    runCapture('git', ['diff', '--stat', 'HEAD'], { cwd: root }),
  ]);

  const head = await gitShortHead(root);

  let reviewState = null;
  try {
    const raw = fs.readFileSync(path.join(root, '.claude_review_state.json'), 'utf8');
    reviewState = JSON.parse(raw);
  } catch {
    // no state file — graceful fallback
  }

  return {
    nameStatusLines: (nameStatus.stdout || '').trim().split('\n').filter(Boolean),
    porcelainLines: (porcelain.stdout || '').trim().split('\n').filter(Boolean),
    branch: (branch.stdout || '').trim(),
    diffStatRaw: (diffStat.stdout || '').trim(),
    head: head || 'unknown',
    reviewState,
  };
}

// ---------------------------------------------------------------------------
// Diff summary
// ---------------------------------------------------------------------------
function parseDiffSummary(nameStatusLines, porcelainLines, root) {
  const summary = { added: 0, modified: 0, deleted: 0, renamed: 0, total: 0 };
  const files = [];
  const seen = new Set();
  for (const line of nameStatusLines) {
    // Handle rename/copy: R100\told\tnew or C100\told\tnew
    const renameMatch = line.match(/^([RC]\d*)\t[^\t]+\t(.+)$/);
    if (renameMatch) {
      const file = renameMatch[2]; // use new path
      if (!seen.has(file)) {
        files.push({ status: renameMatch[1][0], file });
        seen.add(file);
        summary.renamed++;
      }
      continue;
    }
    const m = line.match(/^([AMD])\t(.+)$/);
    if (!m) continue;
    const status = m[1];
    const file = m[2];
    if (seen.has(file)) continue;
    files.push({ status, file });
    seen.add(file);
    if (status === 'A') summary.added++;
    else if (status === 'M') summary.modified++;
    else if (status === 'D') summary.deleted++;
  }
  // Include untracked files from porcelain (marked with ??)
  for (const line of porcelainLines) {
    const m = line.match(/^\?\?\s+(.+)$/);
    if (!m) continue;
    const raw = m[1];
    // If it's a directory (trailing /), expand to individual files
    if (raw.endsWith('/')) {
      const dirPath = raw.slice(0, -1);
      try {
        const expandDir = (dir, base) => {
          const entries = fs.readdirSync(path.join(base, dir), { withFileTypes: true });
          for (const entry of entries) {
            const rel = `${dir}/${entry.name}`;
            if (entry.isDirectory()) expandDir(rel, base);
            else if (!seen.has(rel)) {
              files.push({ status: 'A', file: rel });
              seen.add(rel);
              summary.added++;
            }
          }
        };
        expandDir(dirPath, root);
      } catch {
        // fallback: add the directory path itself
        if (!seen.has(dirPath)) {
          files.push({ status: 'A', file: dirPath });
          seen.add(dirPath);
          summary.added++;
        }
      }
    } else {
      const file = raw;
      if (!seen.has(file)) {
        files.push({ status: 'A', file });
        seen.add(file);
        summary.added++;
      }
    }
  }
  summary.total = files.length;
  return { summary, files };
}

function fileTypeCounts(files) {
  const counts = {};
  for (const { file } of files) {
    const ext = path.extname(file) || '(no ext)';
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------
function evaluateGates(reviewState, files) {
  const nonVendorFiles = files.filter(f =>
    !IGNORE_PREFIXES.some(prefix => f.file.startsWith(prefix))
  );
  const hasCode = nonVendorFiles.some(f => CODE_EXTS.includes(path.extname(f.file)));
  const hasDocs = nonVendorFiles.some(f => DOC_EXTS.includes(path.extname(f.file)));

  const gates = {
    code_review: { required: hasCode, passed: false },
    doc_review: { required: hasDocs, passed: false },
    precommit: { required: hasCode, passed: false },
  };

  if (reviewState) {
    if (reviewState.code_review) gates.code_review.passed = !!reviewState.code_review.passed;
    if (reviewState.doc_review) gates.doc_review.passed = !!reviewState.doc_review.passed;
    if (reviewState.precommit) gates.precommit.passed = !!reviewState.precommit.passed;
  }

  return gates;
}

// ---------------------------------------------------------------------------
// Feature context resolution (5-level fallback)
// ---------------------------------------------------------------------------
function resolveFeatureContext(root, branch, changedPaths) {
  const docsBase = path.join(root, 'docs', 'features');

  function probe(key) {
    const docsPath = path.join(docsBase, key);
    try {
      if (!fs.statSync(docsPath).isDirectory()) return null;
    } catch { return null; }
    let hasTechSpec = false;
    let hasRequests = false;
    try {
      const entries = fs.readdirSync(docsPath);
      hasTechSpec = entries.some(e => /^2-tech-spec/.test(e));
      hasRequests = entries.includes('requests');
    } catch { /* ignore */ }
    return { key, docs_path: `docs/features/${key}`, has_tech_spec: hasTechSpec, has_requests: hasRequests };
  }

  // Validate feature key (prevent path traversal)
  const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

  // Level 1: --feature CLI arg
  if (FEATURE_KEY) {
    if (!SLUG_RE.test(FEATURE_KEY)) {
      return { key: null, source: 'none', confidence: null, docs_path: null, has_tech_spec: false, has_requests: false };
    }
    const info = probe(FEATURE_KEY);
    if (info) return { ...info, source: 'cli', confidence: 'high' };
    return { key: FEATURE_KEY, source: 'cli', confidence: 'high', docs_path: `docs/features/${FEATURE_KEY}`, has_tech_spec: false, has_requests: false };
  }

  // Level 2: branch feat/<key> (single segment only to prevent path issues)
  const branchMatch = branch.match(/^feat\/([^/]+)$/);
  if (branchMatch) {
    const key = branchMatch[1];
    const info = probe(key);
    if (info) return { ...info, source: 'branch', confidence: 'high' };
    return { key, source: 'branch', confidence: 'high', docs_path: `docs/features/${key}`, has_tech_spec: false, has_requests: false };
  }

  // Level 3: changed paths under docs/features/<key>/
  const featurePathMatch = changedPaths
    .map(p => p.match(/^docs\/features\/([^/]+)\//))
    .find(m => m);
  if (featurePathMatch) {
    const key = featurePathMatch[1];
    const info = probe(key);
    if (info) return { ...info, source: 'diff', confidence: 'medium' };
    return { key, source: 'diff', confidence: 'medium', docs_path: `docs/features/${key}`, has_tech_spec: false, has_requests: false };
  }

  // Level 4: single feature dir
  try {
    const dirs = fs.readdirSync(docsBase).filter(d => {
      try { return fs.statSync(path.join(docsBase, d)).isDirectory(); } catch { return false; }
    });
    if (dirs.length === 1) {
      const info = probe(dirs[0]);
      if (info) return { ...info, source: 'single_dir', confidence: 'low' };
    }
  } catch { /* docs/features/ doesn't exist */ }

  // Level 5: not found
  return { key: null, source: 'none', confidence: null, docs_path: null, has_tech_spec: false, has_requests: false };
}

// ---------------------------------------------------------------------------
// Request status parsing
// ---------------------------------------------------------------------------
function parseRequestStatus(content) {
  // Table format: | Status | **Value** | or | Status | Value |
  const m = content.match(/^\|\s*Status\s*\|\s*\*\*(.+?)\*\*\s*\|/m)
           || content.match(/^\|\s*Status\s*\|\s*(.+?)\s*\|/m)
           // Blockquote format: > **Status**: Value
           || content.match(/^>\s*\*\*Status\*\*:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Phase detection
// ---------------------------------------------------------------------------
function detectPhase(gates, findings, reviewState, files) {
  const hasChanges = files.length > 0;
  const allGatesPass = Object.values(gates).every(g => !g.required || g.passed);
  const hasP0P1 = findings.some(f => f.priority === 'P0' || f.priority === 'P1');

  if (!hasChanges && allGatesPass) {
    return findings.some(f => f.id === 'feature-complete') ? 'feature_complete' : 'clean';
  }
  if (reviewState && gates.precommit.required && gates.precommit.passed && !hasP0P1) return 'post_precommit';
  if (allGatesPass && !hasP0P1) return 'ready_to_commit';
  return 'mid_development';
}

// ---------------------------------------------------------------------------
// Next actions builder
// ---------------------------------------------------------------------------
function buildNextActions(findings, phase, featureCtx) {
  const actions = [];

  // Extract commands from P0/P1 findings
  for (const f of findings) {
    if (f.priority !== 'P0' && f.priority !== 'P1') continue;
    const cmdMatch = f.suggestion.match(/\/[\w-]+/);
    if (cmdMatch) {
      const cmd = cmdMatch[0];
      // Extract path/flag args after command (skip prose words)
      const afterCmd = f.suggestion.slice(f.suggestion.indexOf(cmd) + cmd.length).trim();
      const argTokens = afterCmd.split(/\s+/).filter(t => t.startsWith('--') || t.includes('/') || t.includes('.'));
      actions.push({
        id: f.id,
        command: qualifyCommand(cmd),
        args: argTokens.length > 0 ? argTokens.join(' ') : null,
        reason: f.message,
        confidence: f.priority === 'P0' ? 1.0 : 0.8,
      });
    }
  }

  // Phase-based suggestions
  if (phase === 'post_precommit' && featureCtx.key) {
    if (featureCtx.has_tech_spec) {
      actions.push({
        id: 'doc-sync',
        command: qualifyCommand('/update-docs'),
        args: `${featureCtx.docs_path}/2-tech-spec.md`,
        reason: 'Precommit passed — sync docs with code changes',
        confidence: 0.9,
      });
    }
    if (featureCtx.has_requests) {
      actions.push({
        id: 'request-update',
        command: qualifyCommand('/create-request'),
        args: '--update',
        reason: 'Precommit passed — update request status',
        confidence: 0.8,
      });
    }
  }

  // Sort by confidence descending
  actions.sort((a, b) => b.confidence - a.confidence);

  return actions;
}

// ---------------------------------------------------------------------------
// Backlog context builder
// ---------------------------------------------------------------------------
function buildBacklogContext(root) {
  const docsBase = path.join(root, 'docs', 'features');
  const result = { total_features: 0, incomplete_features: [] };
  let dirs;
  try {
    dirs = fs.readdirSync(docsBase).filter(d => {
      try { return fs.statSync(path.join(docsBase, d)).isDirectory(); } catch { return false; }
    });
  } catch { return result; }

  result.total_features = dirs.length;

  for (const key of dirs) {
    const reqDir = path.join(docsBase, key, 'requests');
    let status = null;
    let uncheckedAc = 0;
    let totalAc = 0;
    try {
      const reqFiles = fs.readdirSync(reqDir).filter(f => f.endsWith('.md'));
      for (const rf of reqFiles) {
        const content = fs.readFileSync(path.join(reqDir, rf), 'utf8');
        const s = parseRequestStatus(content);
        if (s) status = s;
        const checked = (content.match(/- \[x\]/gi) || []).length;
        const unchecked = (content.match(/- \[ \]/g) || []).length;
        totalAc += checked + unchecked;
        uncheckedAc += unchecked;
      }
    } catch { /* no requests dir */ }

    // Include if status suggests incomplete or has unchecked AC
    const isIncomplete = (status && INCOMPLETE_STATUSES.some(s => status.toLowerCase().includes(s.toLowerCase()))) || uncheckedAc > 0;
    if (isIncomplete) {
      result.incomplete_features.push({ key, status, unchecked_ac: uncheckedAc, total_ac: totalAc });
    }
  }

  // Top 5
  result.incomplete_features = result.incomplete_features.slice(0, 5);
  return result;
}

// ---------------------------------------------------------------------------
// Heuristics (16 checks)
// ---------------------------------------------------------------------------
function runHeuristics(inputs, files, gates, root, featureCtx) {
  const findings = [];
  const { porcelainLines, branch, reviewState } = inputs;
  const changedPaths = files.map(f => f.file);

  // Helper: check if a directory exists in repo
  function dirExists(rel) {
    try { return fs.statSync(path.join(root, rel)).isDirectory(); } catch { return false; }
  }

  // Helper: check if glob pattern files exist in repo
  function globFilesExist(pattern) {
    try {
      const entries = fs.readdirSync(root);
      return entries.some(e => new RegExp(pattern).test(e));
    } catch { return false; }
  }

  // 1. state-drift: review state flags inconsistent with git
  const hasChanges = porcelainLines.length > 0 || files.length > 0;
  if (reviewState) {
    if (!hasChanges && (reviewState.has_code_change || reviewState.has_doc_change)) {
      findings.push({
        id: 'state-drift',
        priority: 'P0',
        message: 'Review state says changes exist but worktree is clean',
        suggestion: 'Reset .claude_review_state.json or investigate stale state',
      });
    }
  }

  // 2-4: gate-missing checks — only when there are actual changes.
  // When worktree is clean, state-drift above covers stale state.
  // Note: stop-guard.sh enforces independently via has_code_change;
  // this script is advisory — "reset state" is correct when nothing to review.
  // Gate checks use computed gates.*.required (vendor-filtered) as authoritative.
  // Although post-edit-format.sh now also skips vendor paths, the computed gates
  // remain the single source of truth for this advisory script.
  if (hasChanges) {
    // 2. gate-missing-code: non-vendor code changed, review not passed
    if (reviewState && gates.code_review.required && !gates.code_review.passed) {
      findings.push({
        id: 'gate-missing-code',
        priority: 'P0',
        message: 'Code changed but code review has not passed',
        suggestion: 'Run /codex-review-fast before proceeding',
      });
    }

    // 3. gate-missing-doc: docs changed, doc review not passed
    if (reviewState && gates.doc_review.required && !gates.doc_review.passed) {
      findings.push({
        id: 'gate-missing-doc',
        priority: 'P0',
        message: 'Documentation changed but doc review has not passed',
        suggestion: 'Run /codex-review-doc before proceeding',
      });
    }

    // 4. gate-missing-precommit: non-vendor code requires precommit, review passed but precommit not
    if (reviewState && gates.precommit.required && gates.code_review.passed && !gates.precommit.passed) {
      findings.push({
        id: 'gate-missing-precommit',
        priority: 'P0',
        message: 'Code review passed but precommit has not passed',
        suggestion: 'Run /precommit before committing',
      });
    }
  }

  // 5. test-gap: source changed, no matching test in diff (ecosystem-aware)
  const srcPrefixes = CLASSIFICATION?.test_gap?.source_prefixes ?? ['src/'];
  const hasSrcDir = srcPrefixes.some(p => dirExists(p.replace(/\/$/, '')));
  if (hasSrcDir) {
    // Skip for ecosystems with co-located tests (Go _test.go, Rust #[cfg(test)])
    const skipEco = CLASSIFICATION?.test_gap?.skip_ecosystems ?? [];
    const ecoManifests = CLASSIFICATION?.test_gap?.ecosystem_manifests ?? {};
    const shouldSkip = skipEco.some(eco => {
      const manifests = ecoManifests[eco] ?? [];
      return manifests.some(m => {
        try { return fs.statSync(path.join(root, m)).isFile(); } catch { return false; }
      });
    });

    if (!shouldSkip) {
      const srcFiles = changedPaths.filter(p =>
        srcPrefixes.some(prefix => p.startsWith(prefix)) &&
        !IGNORE_PREFIXES.some(prefix => p.startsWith(prefix))
      );
      const testIndicators = CLASSIFICATION?.test_gap?.test_indicators ?? {
        directory_prefixes: ['test/'],
        file_suffixes: ['.test.ts', '.test.js', '.test.tsx', '.test.jsx'],
      };
      const testFiles = changedPaths.filter(p =>
        testIndicators.directory_prefixes.some(prefix => p.startsWith(prefix)) ||
        testIndicators.file_suffixes.some(suffix => p.endsWith(suffix))
      );
      if (srcFiles.length > 0 && testFiles.length === 0) {
        findings.push({
          id: 'test-gap',
          priority: 'P1',
          message: `${srcFiles.length} source file(s) changed but no test files in diff`,
          suggestion: 'Write or update tests for changed source files',
        });
      }
    }
  }

  // 6. security-hotspot: auth/security files touched (check full path)
  const securityPattern = /auth|security|token|credential|password|secret|crypto|session/i;
  const securityFiles = changedPaths.filter(p => securityPattern.test(p));
  if (securityFiles.length > 0) {
    findings.push({
      id: 'security-hotspot',
      priority: 'P1',
      message: `Security-sensitive file(s) touched: ${securityFiles.slice(0, 3).join(', ')}`,
      suggestion: 'Run /codex-security before merging',
    });
  }

  // 7. migration-risk: schema/migration files changed
  const migrationPattern = /migration|schema|\.sql$/i;
  const migrationFiles = changedPaths.filter(p => migrationPattern.test(p));
  if (migrationFiles.length > 0) {
    findings.push({
      id: 'migration-risk',
      priority: 'P1',
      message: `Schema/migration file(s) changed: ${migrationFiles.slice(0, 3).join(', ')}`,
      suggestion: 'Verify migration is reversible and tested against staging data',
    });
  }

  // 8. readme-missing: new command added, README not updated (profile-gated)
  if (dirExists('commands')) {
    const newCommands = files.filter(f => f.file.startsWith('commands/') && f.file.endsWith('.md') && f.status === 'A');
    const readmeChanged = changedPaths.some(p => /^README(\..+)?\.md$/.test(p));
    if (newCommands.length > 0 && !readmeChanged) {
      findings.push({
        id: 'readme-missing',
        priority: 'P2',
        message: `New command(s) added (${newCommands.map(f => f.file).join(', ')}) but README not updated`,
        suggestion: 'Run /update-docs to sync README with new commands',
      });
    }
  }

  // 9. skill-lint-needed: skills changed, lint not evidenced (profile-gated)
  if (dirExists('skills')) {
    const skillFiles = changedPaths.filter(p => /^skills\/.*\/SKILL\.md$/.test(p));
    if (skillFiles.length > 0) {
      findings.push({
        id: 'skill-lint-needed',
        priority: 'P2',
        message: `${skillFiles.length} SKILL.md file(s) changed — lint not evidenced`,
        suggestion: 'Run /skill-health-check to validate skill quality',
      });
    }
  }

  // 10. locale-drift: one locale README changed, siblings not (profile-gated)
  if (globFilesExist('^README\\..+\\.md$')) {
    const allReadmes = (() => {
      try {
        return fs.readdirSync(root).filter(f => /^README(\..+)?\.md$/.test(f));
      } catch { return []; }
    })();
    const changedReadmes = changedPaths.filter(p => /^README(\..+)?\.md$/.test(p));
    if (allReadmes.length > 1 && changedReadmes.length > 0 && changedReadmes.length < allReadmes.length) {
      const missing = allReadmes.filter(r => !changedReadmes.includes(r));
      findings.push({
        id: 'locale-drift',
        priority: 'P2',
        message: `${changedReadmes.length}/${allReadmes.length} README locale(s) updated, missing: ${missing.slice(0, 3).join(', ')}`,
        suggestion: 'Update remaining locale READMEs to keep translations in sync',
      });
    }
  }

  // 11. mixed-concerns: wide-ranging diff across >3 top-level dirs
  const topDirs = new Set(changedPaths.map(p => p.split('/')[0]).filter(Boolean));
  if (topDirs.size > 3) {
    findings.push({
      id: 'mixed-concerns',
      priority: 'P2',
      message: `Changes span ${topDirs.size} top-level directories: ${[...topDirs].slice(0, 5).join(', ')}`,
      suggestion: 'Consider splitting into focused commits per concern',
    });
  }

  // 12. main-branch: working directly on main/master
  if (branch === 'main' || branch === 'master') {
    findings.push({
      id: 'main-branch',
      priority: 'P3',
      message: `Working directly on ${branch} branch`,
      suggestion: 'Consider creating a feature branch for non-trivial changes',
    });
  }

  // 13. doc-sync-needed: precommit passed + feature has tech-spec + code in diff
  if (reviewState && gates.precommit.passed && featureCtx && featureCtx.key) {
    if (featureCtx.has_tech_spec) {
      const codeInDiff = changedPaths.some(p => CODE_EXTS.includes(path.extname(p)));
      if (codeInDiff) {
        findings.push({
          id: 'doc-sync-needed',
          priority: 'P1',
          message: `Code changed with precommit passed — docs may be stale for feature "${featureCtx.key}"`,
          suggestion: `/update-docs ${featureCtx.docs_path}/2-tech-spec.md`,
        });
      }
    }
  }

  // 14. request-stale: precommit passed + request status matches INCOMPLETE_STATUSES
  if (reviewState && gates.precommit.passed && featureCtx && featureCtx.key && featureCtx.has_requests) {
    const reqDir = path.join(root, featureCtx.docs_path, 'requests');
    try {
      const reqFiles = fs.readdirSync(reqDir).filter(f => f.endsWith('.md'));
      for (const rf of reqFiles) {
        try {
          const content = fs.readFileSync(path.join(reqDir, rf), 'utf8');
          const status = parseRequestStatus(content);
          if (status) {
            if (INCOMPLETE_STATUSES.some(s => status.toLowerCase().includes(s.toLowerCase()))) {
              findings.push({
                id: 'request-stale',
                priority: 'P1',
                message: `Request "${rf}" status is "${status}" but precommit has passed`,
                suggestion: `/create-request --update ${featureCtx.docs_path}/requests/${rf}`,
              });
              break; // one finding is enough
            }
          }
        } catch { /* skip unreadable file */ }
      }
    } catch { /* no requests dir */ }
  }

  // 15. ac-incomplete: request has unchecked acceptance criteria
  if (featureCtx && featureCtx.key && featureCtx.has_requests) {
    const reqDir = path.join(root, featureCtx.docs_path, 'requests');
    try {
      const reqFiles = fs.readdirSync(reqDir).filter(f => f.endsWith('.md'));
      let totalChecked = 0;
      let totalUnchecked = 0;
      for (const rf of reqFiles) {
        try {
          const content = fs.readFileSync(path.join(reqDir, rf), 'utf8');
          totalChecked += (content.match(/- \[x\]/gi) || []).length;
          totalUnchecked += (content.match(/- \[ \]/g) || []).length;
        } catch { /* skip */ }
      }
      if (totalUnchecked > 0) {
        const total = totalChecked + totalUnchecked;
        findings.push({
          id: 'ac-incomplete',
          priority: 'P2',
          message: `${totalUnchecked}/${total} acceptance criteria unchecked for feature "${featureCtx.key}"`,
          suggestion: 'Review and complete remaining acceptance criteria',
        });
      }
    } catch { /* no requests dir */ }
  }

  // 16. feature-complete: all gates pass + no doc-sync or request-stale issues
  if (featureCtx && featureCtx.key) {
    const allGatesPass = Object.values(gates).every(g => !g.required || g.passed);
    const hasBlockers = findings.some(f => f.id === 'doc-sync-needed' || f.id === 'request-stale' || f.id === 'ac-incomplete');
    if (allGatesPass && !hasBlockers && reviewState && gates.precommit.passed) {
      findings.push({
        id: 'feature-complete',
        priority: 'P3',
        message: `Feature "${featureCtx.key}" appears complete — all gates passed, no sync issues`,
        suggestion: 'Ready for commit and /pr-review',
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function buildOutput(inputs, root) {
  const { summary, files } = parseDiffSummary(inputs.nameStatusLines, inputs.porcelainLines, root);
  const types = fileTypeCounts(files);
  const gates = evaluateGates(inputs.reviewState, files);
  const changedPaths = files.map(f => f.file);
  const featureCtx = resolveFeatureContext(root, inputs.branch, changedPaths);
  const allFindings = runHeuristics(inputs, files, gates, root, featureCtx);

  // Sort by priority
  const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  allFindings.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

  const suppressed = Math.max(0, allFindings.length - MAX_FINDINGS);
  const findings = allFindings.slice(0, MAX_FINDINGS);

  const findingCount = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of allFindings) {
    findingCount[f.priority] = (findingCount[f.priority] || 0) + 1;
  }

  const phase = detectPhase(gates, allFindings, inputs.reviewState, files);
  const next_actions = buildNextActions(allFindings, phase, featureCtx);
  const backlog = phase === 'feature_complete' ? buildBacklogContext(root) : null;

  return {
    version: 2,
    repo: path.basename(root),
    branch: inputs.branch,
    head: inputs.head,
    diff_summary: summary,
    file_types: types,
    gates,
    findings,
    finding_count: findingCount,
    suppressed,
    phase,
    feature_context: featureCtx,
    next_actions,
    backlog,
  };
}

function formatMarkdown(output) {
  const lines = [];
  lines.push(`## Next-Step Analysis`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Repo | ${output.repo} |`);
  lines.push(`| Branch | ${output.branch} |`);
  lines.push(`| HEAD | ${output.head} |`);
  lines.push(`| Files changed | ${output.diff_summary.total} |`);
  lines.push('');

  // Gates
  lines.push('### Gates');
  lines.push('');
  lines.push('| Gate | Required | Passed |');
  lines.push('|------|----------|--------|');
  for (const [name, g] of Object.entries(output.gates)) {
    const req = g.required ? 'Yes' : 'No';
    const pass = g.required ? (g.passed ? 'Yes' : '**No**') : 'N/A';
    lines.push(`| ${name} | ${req} | ${pass} |`);
  }
  lines.push('');

  // Phase + Feature Context
  lines.push(`### Context`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Phase | ${output.phase} |`);
  if (output.feature_context && output.feature_context.key) {
    lines.push(`| Feature | ${output.feature_context.key} (${output.feature_context.source}, ${output.feature_context.confidence}) |`);
  }
  lines.push('');

  // Findings
  if (output.findings.length > 0) {
    lines.push(`### Findings (${output.findings.length})`);
    lines.push('');
    for (const f of output.findings) {
      lines.push(`- **[${f.priority}] ${f.id}** — ${f.message}`);
      lines.push(`  → ${f.suggestion}`);
    }
    if (output.suppressed > 0) {
      lines.push(`- _+${output.suppressed} more suppressed_`);
    }
    lines.push('');
  } else {
    lines.push('### Findings');
    lines.push('');
    lines.push('No findings — all clear.');
    lines.push('');
  }

  // Next Actions
  if (output.next_actions && output.next_actions.length > 0) {
    lines.push(`### Next Actions`);
    lines.push('');
    for (const a of output.next_actions) {
      const args = a.args ? ` ${a.args}` : '';
      lines.push(`- \`${a.command}${args}\` (${a.confidence.toFixed(1)}) — ${a.reason}`);
    }
    lines.push('');
  }

  // Backlog
  if (output.backlog && output.backlog.incomplete_features.length > 0) {
    lines.push(`### Backlog (${output.backlog.incomplete_features.length}/${output.backlog.total_features} incomplete)`);
    lines.push('');
    for (const f of output.backlog.incomplete_features) {
      lines.push(`- **${f.key}** — status: ${f.status || 'unknown'}, unchecked AC: ${f.unchecked_ac}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const root = await gitRepoRoot();
  if (!root) {
    console.error('Not in a git repository');
    process.exit(1);
  }

  const inputs = await collectInputs(root);
  const output = buildOutput(inputs, root);

  if (FORMAT === 'markdown') {
    console.log(formatMarkdown(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  // Exit code based on findings
  if (output.finding_count.P0 > 0) process.exit(2);
  if (output.finding_count.P1 > 0) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('analyze.js error:', err.message);
  process.exit(1);
});
