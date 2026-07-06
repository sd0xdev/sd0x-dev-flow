'use strict';

const { readFileSync, existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

/**
 * Resolve session commit scope: compute included/excluded/warned file sets.
 * Stage 5 of the smart-commit selection pipeline.
 *
 * @param {object} opts
 * @param {string} opts.cwd - Working directory (repo root)
 * @param {boolean} [opts.all=false] - Disable session-aware filtering
 * @param {string} [opts.scope] - Path prefix filter
 * @returns {{ included: string[], excluded: string[], warned: string[], mode: string }}
 */
function resolveSessionScope({ cwd, all = false, scope } = {}) {
  const stateFile = join(cwd, '.claude_review_state.json');
  const gitFiles = collectGitStatus(cwd, scope);

  if (all || !existsSync(stateFile)) {
    return { included: gitFiles.all, excluded: [], warned: [], mode: 'all' };
  }

  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return { included: gitFiles.all, excluded: [], warned: [], mode: 'all' };
  }

  const scs = state.session_commit_scope;
  // session_id check is internal consistency (scope vs state-file root), not a
  // live-session probe: session-init rewrites the root session_id each new
  // session, so a mismatch means the scope was written by an earlier session.
  if (!scs || scs.session_id !== state.session_id || scs.baseline_dirty_files === null || scs.baseline_dirty_files === undefined) {
    return { included: gitFiles.all, excluded: [], warned: [], mode: 'all' };
  }

  const touched = new Set(scs.touched_files || []);
  const baseline = new Set(scs.baseline_dirty_files || []);

  const included = [];
  const excluded = [];
  const warned = [];

  for (const file of gitFiles.staged) {
    included.push(file);
  }

  for (const file of gitFiles.unstaged) {
    if (touched.has(file)) {
      included.push(file);
      if (baseline.has(file)) {
        warned.push(file);
      }
    } else {
      excluded.push(file);
    }
  }

  return { included: [...new Set(included)], excluded, warned, mode: 'session-aware' };
}

/**
 * Collect git status files, separated into staged and unstaged.
 * @param {string} cwd
 * @param {string} [scope]
 * @returns {{ all: string[], staged: string[], unstaged: string[] }}
 */
function collectGitStatus(cwd, scope) {
  const args = ['status', '--porcelain', '-z'];
  if (scope) args.push('--', scope);
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return { all: [], staged: [], unstaged: [] };
  }

  const staged = [];
  const unstaged = [];
  const all = [];

  // NUL-delimited: split on \0, parse XY + path entries
  // Rename/Copy: XY dest\0src\0 (two consecutive NUL-delimited entries)
  const entries = result.stdout.split('\0');
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (!entry || entry.length < 3) { i++; continue; }

    const x = entry[0]; // index status
    const y = entry[1]; // worktree status
    const filePath = entry.slice(3);

    // Rename/Copy: next entry is the source path — skip it
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i++; // skip src entry
    }

    all.push(filePath);

    if (x !== ' ' && x !== '?') {
      staged.push(filePath);
    }
    if (y !== ' ' || x === '?') {
      unstaged.push(filePath);
    }
    i++;
  }

  return { all: [...new Set(all)], staged: [...new Set(staged)], unstaged: [...new Set(unstaged)] };
}

module.exports = { resolveSessionScope, collectGitStatus };
