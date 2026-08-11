#!/usr/bin/env node
'use strict';

const { resolveFeatureContext, EMPTY_CONTEXT } = require('./lib/feature-resolver');
const { runCapture, gitRepoRoot } = require('./lib/utils');

/**
 * What this CLI prints when it has nothing to report. It used to print `{}` — and this is the CLI
 * the skills actually invoke, so `{}` is what they got on a machine outside a git repository or on
 * any unexpected throw. `scan_error: true` because neither exit enumerated anything: the sets are
 * unknown, not empty.
 */
function emptyPayload() {
  return JSON.stringify({ ...EMPTY_CONTEXT(), scan_error: true });
}

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function main() {
  const root = await gitRepoRoot();
  if (!root) {
    console.log(emptyPayload());
    process.exit(0);
  }

  const [branchRes, diffRes] = await Promise.all([
    runCapture('git', ['branch', '--show-current'], { cwd: root }),
    runCapture('git', ['diff', '--name-only', 'HEAD'], { cwd: root }),
  ]);

  const branch = (branchRes.stdout || '').trim();
  const changedPaths = (diffRes.stdout || '').split('\n').filter(Boolean);
  const featureKey = argVal('--feature') || undefined;

  const result = resolveFeatureContext(root, branch, changedPaths, { featureKey });
  console.log(JSON.stringify(result));
}

main().catch(() => {
  console.log(emptyPayload());
  process.exit(0);
});
