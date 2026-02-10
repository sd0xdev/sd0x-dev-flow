#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runCapture, gitRepoRoot, gitShortHead } = require('../../../scripts/lib/utils');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const MAX_FINDINGS = Number(argVal('--max-findings')) || 8;
const FORMAT = process.argv.includes('--markdown') ? 'markdown' : 'json';

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
  const hasCode = files.some(f => /\.(ts|js|tsx|jsx)$/.test(f.file));
  const hasDocs = files.some(f => /\.md$/.test(f.file));

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
// Heuristics (12 checks)
// ---------------------------------------------------------------------------
function runHeuristics(inputs, files, gates, root) {
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
  if (reviewState) {
    const porcelainClean = porcelainLines.length === 0 && files.length === 0;
    if (porcelainClean && (reviewState.has_code_change || reviewState.has_doc_change)) {
      findings.push({
        id: 'state-drift',
        priority: 'P0',
        message: 'Review state says changes exist but worktree is clean',
        suggestion: 'Reset .claude_review_state.json or investigate stale state',
      });
    }
  }

  // 2. gate-missing-code: code changed, review not passed
  if (reviewState && (gates.code_review.required || reviewState.has_code_change) && !gates.code_review.passed) {
    findings.push({
      id: 'gate-missing-code',
      priority: 'P0',
      message: 'Code changed but code review has not passed',
      suggestion: 'Run /codex-review-fast before proceeding',
    });
  }

  // 3. gate-missing-doc: docs changed, doc review not passed
  if (reviewState && (gates.doc_review.required || reviewState.has_doc_change) && !gates.doc_review.passed) {
    findings.push({
      id: 'gate-missing-doc',
      priority: 'P0',
      message: 'Documentation changed but doc review has not passed',
      suggestion: 'Run /codex-review-doc before proceeding',
    });
  }

  // 4. gate-missing-precommit: code review passed, precommit not passed
  if (reviewState && gates.code_review.passed && !gates.precommit.passed) {
    findings.push({
      id: 'gate-missing-precommit',
      priority: 'P0',
      message: 'Code review passed but precommit has not passed',
      suggestion: 'Run /precommit before committing',
    });
  }

  // 5. test-gap: src/ changed, no matching test/ in diff (profile-gated)
  if (dirExists('src')) {
    const srcFiles = changedPaths.filter(p => p.startsWith('src/'));
    const testFiles = changedPaths.filter(p => /^test\//.test(p) || /\.test\.(ts|js|tsx|jsx)$/.test(p));
    if (srcFiles.length > 0 && testFiles.length === 0) {
      findings.push({
        id: 'test-gap',
        priority: 'P1',
        message: `${srcFiles.length} src/ file(s) changed but no test files in diff`,
        suggestion: 'Write or update tests for changed source files',
      });
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

  return findings;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function buildOutput(inputs, root) {
  const { summary, files } = parseDiffSummary(inputs.nameStatusLines, inputs.porcelainLines, root);
  const types = fileTypeCounts(files);
  const gates = evaluateGates(inputs.reviewState, files);
  const allFindings = runHeuristics(inputs, files, gates, root);

  // Sort by priority
  const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  allFindings.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

  const suppressed = Math.max(0, allFindings.length - MAX_FINDINGS);
  const findings = allFindings.slice(0, MAX_FINDINGS);

  const findingCount = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of allFindings) {
    findingCount[f.priority] = (findingCount[f.priority] || 0) + 1;
  }

  return {
    version: 1,
    repo: path.basename(root),
    branch: inputs.branch,
    head: inputs.head,
    diff_summary: summary,
    file_types: types,
    gates,
    findings,
    finding_count: findingCount,
    suppressed,
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
