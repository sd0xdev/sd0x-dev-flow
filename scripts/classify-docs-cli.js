#!/usr/bin/env node
'use strict';

const { resolveFeatureContext, EMPTY_CANONICAL, EMPTY_CONTEXT } = require('./lib/feature-resolver');
const { emptySourceSets } = require('./lib/doc-classifier');
const { runCapture, gitRepoRoot } = require('./lib/utils');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

/**
 * What the CLI prints when it has nothing to report. It used to print `{}`, which made every
 * consumer's `result.current_authority.map(...)` a TypeError on exactly the paths — no repository,
 * an unexpected throw — where a consumer is least able to diagnose it. The keys are always present
 * and always the right type; only their contents vary.
 */
function emptyPayload() {
  const { key, docs_path, doc_inventory, canonical_docs,
    current_authority, design_records, work_records, history_records } = EMPTY_CONTEXT();
  // The resolver's own null shape, projected onto this CLI's narrower schema — `canonical_docs` is
  // its four-key null map rather than `{}`, so `canonical_docs.tech_spec` is `null` on every exit
  // instead of `undefined` on exactly the exceptional ones.
  return JSON.stringify({
    key, docs_path, doc_inventory, canonical_docs,
    current_authority, design_records, work_records, history_records,
    // Nothing was enumerated, and that is a failure rather than an empty corpus.
    scan_error: true,
  });
}

async function main() {
  const root = await gitRepoRoot();
  if (!root) { console.log(emptyPayload()); process.exit(0); }

  const [branchRes, diffRes] = await Promise.all([
    runCapture('git', ['branch', '--show-current'], { cwd: root }),
    runCapture('git', ['diff', '--name-only', 'HEAD'], { cwd: root }),
  ]);

  const branch = (branchRes.stdout || '').trim();
  const changedPaths = (diffRes.stdout || '').split('\n').filter(Boolean);
  const featureKey = argVal('--feature') || undefined;

  const result = resolveFeatureContext(root, branch, changedPaths, { featureKey });
  console.log(JSON.stringify({
    key: result.key,
    docs_path: result.docs_path,
    doc_inventory: result.doc_inventory || [],
    // Deprecated alias, kept for the consumers still reading it. New callers ask a source set.
    canonical_docs: result.canonical_docs || EMPTY_CANONICAL(),
    current_authority: result.current_authority || [],
    design_records: result.design_records || [],
    work_records: result.work_records || [],
    history_records: result.history_records || [],
    // Present on every exit. `true` means the sets are unknown, not empty — see § probe.
    scan_error: result.scan_error === true,
  }));
}

main().catch(() => {
  console.log(emptyPayload());
  process.exit(0);
});
