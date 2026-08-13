#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Resolve plugin root: validated env var → walk-up with marker → legacy fallback
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

const { runCapture, gitRepoRoot, gitShortHead, qualifyCommand } = require(path.join(_pluginRoot, 'scripts', 'lib', 'utils'));
const { resolveFeatureContext: _resolveFeature } = require(path.join(_pluginRoot, 'scripts', 'lib', 'feature-resolver'));
const { parseRequestStatus, isOpenRequestStatus, HEAD_LINES } = require(path.join(_pluginRoot, 'scripts', 'lib', 'request-status'));

// ---------------------------------------------------------------------------
// File classification config (language-agnostic)
// ---------------------------------------------------------------------------
function loadClassification() {
  try {
    const p = path.join(_pluginRoot, 'scripts', 'config', 'file-classification.json');
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

// Openness comes from scripts/lib/request-status.js, which defines it NEGATIVELY: closed is a
// short exhaustive set, everything else is open.
//
// This file used to keep its own POSITIVE list of four lowercase substrings. Measured against
// the repo's 125 request docs it missed `Candidate Complete` (20 docs — the third most common
// value) and `Spec Complete` (1), while `In Development` and `Nearly Complete` matched nothing
// at all. So `request-stale` was blind to 21 open requests, and `feature-complete` — which
// fires only when no request-stale finding exists — could declare a feature done with those
// still outstanding. Adding the two missing strings would have left the next new status to be
// forgotten the same way; deriving from the closed set cannot go stale in that direction.

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

  // Gate verdicts come from the reminder-state checker (installed copy first), whose
  // answers are content-addressed — `passed` already binds the verdict to the current
  // tree digest, so a stale note reads as not-passed rather than as drift to detect.
  // Checker absent or unparseable → null: this script then reports change-class facts
  // and claims no verdict, exactly like /remind's degraded path.
  let gateState = null;
  let checker = path.join(root, '.claude', 'scripts', 'review-state.js');
  if (!fs.existsSync(checker)) checker = path.join(root, 'scripts', 'review-state.js');
  if (fs.existsSync(checker)) {
    try {
      const r = await runCapture('node', [checker, 'check', '--format=json'], { cwd: root });
      gateState = JSON.parse(r.stdout);
    } catch {
      // checker failed — degraded run, no verdicts
    }
  }

  return {
    nameStatusLines: (nameStatus.stdout || '').trim().split('\n').filter(Boolean),
    porcelainLines: (porcelain.stdout || '').trim().split('\n').filter(Boolean),
    branch: (branch.stdout || '').trim(),
    diffStatRaw: (diffStat.stdout || '').trim(),
    head: head || 'unknown',
    gateState,
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
function evaluateGates(gateState, files) {
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

  // `passed` is the checker's own conjunction (noted && digest_match && verdict pass),
  // so no freshness reasoning happens here — an edit after the note flips it to false.
  if (gateState) {
    if (gateState.code_review) gates.code_review.passed = !!gateState.code_review.passed;
    if (gateState.doc_review) gates.doc_review.passed = !!gateState.doc_review.passed;
    if (gateState.precommit) gates.precommit.passed = !!gateState.precommit.passed;
  }

  return gates;
}

// ---------------------------------------------------------------------------
// Feature context resolution (delegated to shared module)
// ---------------------------------------------------------------------------
function resolveFeatureContext(root, branch, changedPaths) {
  return _resolveFeature(root, branch, changedPaths, { featureKey: FEATURE_KEY });
}


// ---------------------------------------------------------------------------
// Phase detection
// ---------------------------------------------------------------------------
function detectPhase(gates, findings, gateState, files) {
  const hasChanges = files.length > 0;
  const allGatesPass = Object.values(gates).every(g => !g.required || g.passed);
  const hasP0P1 = findings.some(f => f.priority === 'P0' || f.priority === 'P1');

  if (!hasChanges && allGatesPass) {
    return findings.some(f => f.id === 'feature-complete') ? 'feature_complete' : 'clean';
  }
  if (gateState && gates.precommit.required && gates.precommit.passed && !hasP0P1) return 'post_precommit';
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
  // `readdirSync` order is filesystem-dependent, and the `slice(0, 5)` below turns that into which
  // features a user is shown. Sorting makes the report reproducible across machines and reruns.
  dirs.sort();

  for (const key of dirs) {
    const reqDir = path.join(docsBase, key, 'requests');
    // A feature is incomplete if ANY of its requests is still open. The previous shape kept one
    // `status` per feature and let each file overwrite the last, so with two requests — one
    // `Completed`, one `Pending` — whichever the filesystem happened to return second decided
    // whether the feature appeared at all. It also guarded with `status != null`, which discarded
    // exactly the case `request-status.js` defines as open (see the comment at the request-stale
    // finding); openness is therefore evaluated per file, with `null` flowing into the predicate.
    //
    // "No request docs at all" is a different statement from "a request with no Status", and only
    // the latter is an open request — so the loop, not the initial value, is what can mark a
    // feature open.
    const openRequests = [];
    let uncheckedAc = 0;
    let totalAc = 0;
    try {
      const reqFiles = fs.readdirSync(reqDir).filter(f => f.endsWith('.md')).sort();
      for (const rf of reqFiles) {
        let content;
        try {
          content = fs.readFileSync(path.join(reqDir, rf), 'utf8');
        } catch {
          // UNREADABLE IS OPEN. Same rule as a missing Status field: both are the statement "this
          // cannot be confirmed done", and openness here is defined negatively for exactly that
          // reason. Letting the failure reach the outer catch was worse than mis-classifying the
          // one file — that catch wraps the WHOLE loop, so the first unreadable request silently
          // dropped every request after it in sorted order too, and a feature whose only request
          // was unreadable (a broken symlink is enough) disappeared from the backlog entirely.
          openRequests.push({ file: rf, status: null });
          continue;
        }
        const s = parseRequestStatus(content);
        if (isOpenRequestStatus(s)) openRequests.push({ file: rf, status: s });
        const checked = (content.match(/- \[x\]/gi) || []).length;
        const unchecked = (content.match(/- \[ \]/g) || []).length;
        totalAc += checked + unchecked;
        uncheckedAc += unchecked;
      }
    } catch { /* no requests dir */ }

    if (openRequests.length > 0 || uncheckedAc > 0) {
      result.incomplete_features.push({
        key,
        // The first open request in sorted order — deterministic, and null when the feature is
        // listed only because of unchecked AC.
        status: openRequests.length > 0 ? openRequests[0].status : null,
        open_requests: openRequests.length,
        unchecked_ac: uncheckedAc,
        total_ac: totalAc,
      });
    }
  }

  // The TRUE count, captured before truncation. The renderer printed
  // `incomplete_features.length` as the headline number, which after this slice is the LIMIT, not
  // the count: a repo with 21 incomplete features out of 30 reported "5/30 incomplete". The
  // understatement is silent and points the wrong way — it makes a backlog look four times smaller
  // than it is, in the one line a reader uses to decide whether there is a backlog at all.
  result.incomplete_count = result.incomplete_features.length;
  result.incomplete_shown_limit = 5;
  result.incomplete_features = result.incomplete_features.slice(0, result.incomplete_shown_limit);
  return result;
}

// ---------------------------------------------------------------------------
// Heuristics (16 checks)
// ---------------------------------------------------------------------------
function runHeuristics(inputs, files, gates, root, featureCtx) {
  const findings = [];
  const { porcelainLines, branch, gateState } = inputs;
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

  // The former finding 1 (state-drift) retired with the mirror it watched: the
  // reminder state is content-addressed, so a note for a tree that no longer
  // exists reads as not-passed — there is no stored flag left to drift.
  const hasChanges = porcelainLines.length > 0 || files.length > 0;

  // 2-4: gate-missing checks — only when there are actual changes AND the checker
  // answered. Without it this script claims no verdict (like /remind's degraded
  // run) rather than reporting every gate as missing on no evidence.
  // Gate checks use computed gates.*.required (vendor-filtered) as authoritative.
  // Although post-edit-format.sh now also skips vendor paths, the computed gates
  // remain the single source of truth for this advisory script.
  if (hasChanges) {
    // 2. gate-missing-code: non-vendor code changed, review not passed
    if (gateState && gates.code_review.required && !gates.code_review.passed) {
      findings.push({
        id: 'gate-missing-code',
        priority: 'P0',
        message: 'Code changed but code review has not passed',
        suggestion: 'Run /codex-review-fast before proceeding',
      });
    }

    // 3. gate-missing-doc: docs changed, doc review not passed
    if (gateState && gates.doc_review.required && !gates.doc_review.passed) {
      findings.push({
        id: 'gate-missing-doc',
        priority: 'P0',
        message: 'Documentation changed but doc review has not passed',
        suggestion: 'Run /codex-review-doc before proceeding',
      });
    }

    // 4. gate-missing-precommit: non-vendor code requires precommit, review passed but precommit not
    if (gateState && gates.precommit.required && gates.code_review.passed && !gates.precommit.passed) {
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

  // 8. readme-missing: new skill added, README not updated (profile-gated)
  if (dirExists('skills')) {
    const newSkills = files.filter(f => /^skills\/[^/]+\/SKILL\.md$/.test(f.file) && f.status === 'A');
    const readmeChanged = changedPaths.some(p => /^README(\..+)?\.md$/.test(p));
    if (newSkills.length > 0 && !readmeChanged) {
      findings.push({
        id: 'readme-missing',
        priority: 'P2',
        message: `New skill(s) added (${newSkills.map(f => f.file).join(', ')}) but README not updated`,
        suggestion: 'Run /update-docs to sync README with new skills',
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

  // 12b. requirements-advisory: suggest /req-analyze when feature has tech-spec but no requirements doc
  if (featureCtx && featureCtx.key && featureCtx.has_tech_spec && !featureCtx.has_requirements) {
    findings.push({
      id: 'requirements-advisory',
      priority: 'P3',
      message: `Feature "${featureCtx.key}" has tech-spec but no Phase 1 requirements doc (advisory)`,
      suggestion: `/req-analyze ${featureCtx.key}`,
    });
  }

  // 13. doc-sync-needed: precommit passed + feature has tech-spec + code in diff
  if (gateState && gates.precommit.passed && featureCtx && featureCtx.key) {
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

  // 14. request-stale: precommit passed + the request is still open (see request-status.js)
  if (gateState && gates.precommit.passed && featureCtx && featureCtx.key && featureCtx.has_requests) {
    const reqDir = path.join(root, featureCtx.docs_path, 'requests');
    try {
      // `.sort()` because the loop `break`s on the FIRST open request: without it, WHICH request
      // the user is told to update is decided by `readdirSync` order, i.e. by the filesystem. Two
      // runs on two machines name two different files for the same repo state. `buildBacklogContext`
      // already sorts its own request scan for exactly this reason; this one had been left out.
      const reqFiles = fs.readdirSync(reqDir).filter(f => f.endsWith('.md')).sort();
      for (const rf of reqFiles) {
        try {
          const content = fs.readFileSync(path.join(reqDir, rf), 'utf8');
          const status = parseRequestStatus(content);
          // Unconditionally — `null` is an INPUT to this predicate, not a reason to skip it.
          // `request-status.js` defines openness negatively for a reason: "no Status field" and
          // "Status says nothing closed" are the same statement about whether the work is done.
          // Guarding with `if (status)` restored the positive-list behaviour the module replaced,
          // because it made the one value that is never in the closed set — absence — the only one
          // that could not produce a finding, and `feature-complete` fires precisely when no
          // `request-stale` finding exists. The window makes this reachable rather than theoretical:
          // `parseRequestStatus` reads only the first HEAD_LINES, so a Status pushed below that line
          // parses as null in a doc that visibly says "Pending".
          if (isOpenRequestStatus(status)) {
            findings.push({
              id: 'request-stale',
              priority: 'P1',
              message: status
                ? `Request "${rf}" status is "${status}" but precommit has passed`
                : `Request "${rf}" carries no readable Status field (checked the first ${HEAD_LINES} lines) but precommit has passed — an unlabelled request counts as open`,
              suggestion: `/create-request --update ${featureCtx.docs_path}/requests/${rf}`,
            });
            break; // one finding is enough
          }
        } catch (err) {
          // UNREADABLE IS OPEN — the same statement as an absent Status field, and the last path
          // by which `feature-complete` could still fire over a request nobody could read. That is
          // the exact fail-open the `if (status)` guard above was removed to close; skipping here
          // reopened it one level down, and unlike the guard it needs no unusual document to
          // trigger — a broken symlink in `requests/` is enough.
          findings.push({
            id: 'request-stale',
            priority: 'P1',
            message: `Request "${rf}" could not be read (${err.code || err.message}) — an unverifiable request counts as open`,
            suggestion: `/create-request --update ${featureCtx.docs_path}/requests/${rf}`,
          });
          break;
        }
      }
    } catch (err) {
      // `has_requests` said this directory exists, so failing to ENUMERATE it is not "no requests
      // dir" — it is the same unverifiable state as an unreadable file, covering every request at
      // once. ENOENT is the one genuinely empty answer and stays silent.
      if (err.code !== 'ENOENT') {
        findings.push({
          id: 'request-stale',
          priority: 'P1',
          message: `Request directory "${featureCtx.docs_path}/requests" could not be listed (${err.code || err.message}) — no request can be confirmed closed`,
          suggestion: `Check permissions on ${featureCtx.docs_path}/requests`,
        });
      }
    }
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
        } catch {
          // Skipping is safe HERE, and only because of the finding above. An unreadable request
          // makes these counts wrong, but it cannot let `feature-complete` fire: finding 14 runs
          // under a strictly weaker condition than finding 16 (it adds only `has_requests`, which
          // must hold for any request to be unreadable at all), so the same file has already
          // raised a P1 `request-stale`. Emitting a second finding for it would be duplicate noise,
          // not extra safety.
        }
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

  // 15b. corpus-unreadable: the resolver resolved a key but could not enumerate the documents.
  //
  // This is the one finding that has to come *before* the completion claim rather than beside it.
  // The failure payload keeps `key` and clears `has_tech_spec`, `has_requirements`, `has_requests`
  // and the four source sets — the same shape a feature with no documents produces. Every doc and
  // request heuristic above is therefore skipped, and their silence reads as "no doc work remains"
  // when what actually happened is that nothing could be read. `scan_error` is the only field that
  // separates the two, and gating on `!== false` rather than `=== true` is what makes an older
  // payload with no such field count as unknown instead of healthy.
  const corpusUnreadable = Boolean(featureCtx && featureCtx.key && featureCtx.scan_error !== false);
  if (corpusUnreadable) {
    findings.push({
      id: 'corpus-unreadable',
      priority: 'P1',
      message: `Feature "${featureCtx.key}" resolved, but its documents could not be enumerated — doc and request state is unknown, not empty`,
      suggestion: `Check permissions on ${featureCtx.docs_path || 'the feature directory'}; the doc/request findings below are absent because nothing could be read, not because nothing is pending`,
    });
  }

  // 16. feature-complete: all gates pass + no doc-sync or request-stale issues
  if (featureCtx && featureCtx.key && !corpusUnreadable) {
    const allGatesPass = Object.values(gates).every(g => !g.required || g.passed);
    const hasBlockers = findings.some(f => f.id === 'doc-sync-needed' || f.id === 'request-stale' || f.id === 'ac-incomplete');
    if (allGatesPass && !hasBlockers && gateState && gates.precommit.passed) {
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
  const gates = evaluateGates(inputs.gateState, files);
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

  const phase = detectPhase(gates, allFindings, inputs.gateState, files);
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
    // `incomplete_count` is the count; `incomplete_features.length` is what fits on screen. The
    // `??` keeps a backlog object produced by an older analyze.js readable rather than printing
    // `undefined`, and falls back to the same wrong-but-bounded number it used to print.
    const shown = output.backlog.incomplete_features.length;
    const total = output.backlog.incomplete_count ?? shown;
    lines.push(`### Backlog (${total}/${output.backlog.total_features} incomplete)`);
    lines.push('');
    if (total > shown) {
      // Silent truncation reads as "that is all of them". Say what was dropped.
      lines.push(`_Showing the first ${shown} of ${total}, in sorted order._`);
      lines.push('');
    }
    for (const f of output.backlog.incomplete_features) {
      // `unknown` conflated two different facts. A feature listed only for unchecked AC has no open
      // request to report a status FOR, while one whose request carries no readable Status field is
      // open precisely BECAUSE the field is missing — reporting both as "unknown" hid which.
      let status;
      if (f.status) status = f.status;
      else if (f.open_requests > 0) status = 'no Status field (counts as open)';
      else status = 'closed';
      lines.push(`- **${f.key}** — status: ${status}, unchecked AC: ${f.unchecked_ac}`);
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
