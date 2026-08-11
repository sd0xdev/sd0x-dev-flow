#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { scanFeatureDocs, loadTaxonomy } = require('./doc-classifier');
// Shape only, and deliberately from the dependency-free module rather than from `doc-classifier`:
// `scripts/resolve-feature.js` imports the same three factories to build its failure payload, and
// it must be able to do that when *this* file is the thing that failed to load.
const { EMPTY_CANONICAL, EMPTY_CONTEXT, emptySourceSets } = require('./context-shape');

// Validate feature key (prevent path traversal)
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * The result shape for a feature that resolved by NAME but whose directory could not be read.
 *
 * Factored out because there are five such branches and they must agree: a consumer that reads
 * `result.design_records` cannot check first whether the resolution took the fast path, so a
 * branch that omitted the key would hand it `undefined` and turn a "no docs" answer into a
 * TypeError. Every field defaults to the empty-but-present value.
 */
function unreadable(key) {
  return {
    key,
    docs_path: `docs/features/${key}`,
    doc_inventory: [],
    canonical_docs: EMPTY_CANONICAL(),
    ...emptySourceSets(),
    // Confirmed absence, not failure: this shape is returned when the feature directory is simply
    // not there. A directory that exists but cannot be read is a different answer — `probe` sets
    // `scan_error` for that case rather than routing it here.
    scan_error: false,
    has_tech_spec: false,
    has_requirements: false,
    has_requests: false,
  };
}

/**
 * Probe a feature directory for doc inventory and requests.
 * @param {string} docsBase - Absolute path to docs/features/
 * @param {string} key - Feature slug
 * @returns {object|null}
 */
function probe(docsBase, key) {
  const docsPath = path.join(docsBase, key);
  try {
    if (!fs.statSync(docsPath).isDirectory()) return null;
  } catch (err) {
    // "Not there" is a result the caller acts on by trying the next detection level. Anything else
    // — permissions, an I/O error — is a directory we could not look at, and reporting that as
    // "no such feature" is the fail-open reading.
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    return { ...unreadable(key), scan_error: true };
  }
  let hasRequests = false;
  let doc_inventory = [];
  let canonical_docs = EMPTY_CANONICAL();
  let sets = emptySourceSets();
  // Empty sets mean two incompatible things unless the difference is reported: "this feature has
  // no documents of that role" and "the corpus could not be enumerated". A consumer choosing
  // review depth from `current_authority` would read an unreadable directory or a broken taxonomy
  // as "nothing here owes alignment" — the fail-OPEN reading. `scan_error` is the flag that keeps
  // the two apart; only a confirmed absence leaves it false.
  let scan_error = false;
  try {
    const entries = fs.readdirSync(docsPath);
    hasRequests = entries.includes('requests');
    const tax = loadTaxonomy();
    const scan = scanFeatureDocs(docsPath, tax);
    doc_inventory = scan.doc_inventory;
    canonical_docs = scan.canonical_docs;
    sets = {
      current_authority: scan.current_authority,
      design_records: scan.design_records,
      work_records: scan.work_records,
      history_records: scan.history_records,
    };
  } catch {
    // Still non-throwing: a throw here would leave the caller with whatever its own fallback
    // produced — historically `|| echo '{}'`, the shape-less reply this payload exists to replace.
    // `scripts/resolve-feature.js` now owns that fallback centrally; the failure is still reported
    // in the result rather than raised.
    scan_error = true;
    doc_inventory = [];
    canonical_docs = EMPTY_CANONICAL();
    sets = emptySourceSets();
  }
  const hasTechSpec = canonical_docs.tech_spec != null;
  const hasRequirements = canonical_docs.requirements != null;
  return { key, docs_path: `docs/features/${key}`, doc_inventory, canonical_docs, ...sets, scan_error, has_tech_spec: hasTechSpec, has_requirements: hasRequirements, has_requests: hasRequests };
}

/**
 * 5-level feature context resolution with confidence scoring.
 *
 * @param {string} root - Repository root (absolute path)
 * @param {string} branch - Current git branch name
 * @param {string[]} changedPaths - List of changed file paths (relative to root)
 * @param {object} [options]
 * @param {string} [options.docsBase] - Override docs base directory (default: <root>/docs/features)
 * @param {string} [options.featureKey] - Explicit feature key (Level 1 override)
 * @returns {{ key: string|null, source: string, confidence: string|null, docs_path: string|null, doc_inventory: Array, canonical_docs: object, current_authority: Array, design_records: Array, work_records: Array, history_records: Array, scan_error: boolean, has_tech_spec: boolean, has_requirements: boolean, has_requests: boolean }}
 */
function resolveFeatureContext(root, branch, changedPaths, options) {
  const opts = options || {};
  const docsBase = opts.docsBase || path.join(root, 'docs', 'features');
  const featureKey = opts.featureKey || null;

  const nullResult = EMPTY_CONTEXT();

  // Level 1: explicit feature key
  if (featureKey) {
    if (!SLUG_RE.test(featureKey)) return nullResult;
    const info = probe(docsBase, featureKey);
    if (info) return { ...info, source: 'cli', confidence: 'high' };
    return { ...unreadable(featureKey), source: 'cli', confidence: 'high' };
  }

  // Level 2: branch feat/<key> (single segment only to prevent path issues)
  const branchMatch = branch.match(/^feat\/([^/]+)$/);
  if (branchMatch && SLUG_RE.test(branchMatch[1])) {
    const key = branchMatch[1];
    const info = probe(docsBase, key);
    if (info) return { ...info, source: 'branch', confidence: 'high' };
    return { ...unreadable(key), source: 'branch', confidence: 'high' };
  }

  // Level 3: changed paths under docs/features/<key>/
  const featurePathMatch = changedPaths
    .map(p => p.match(/^docs\/features\/([^/]+)\//))
    .find(m => m);
  if (featurePathMatch && SLUG_RE.test(featurePathMatch[1])) {
    const key = featurePathMatch[1];
    const info = probe(docsBase, key);
    if (info) return { ...info, source: 'diff', confidence: 'medium' };
    return { ...unreadable(key), source: 'diff', confidence: 'medium' };
  }

  // Level 3b: changed paths under skills/<key>/
  const skillPathMatch = changedPaths
    .map(p => p.match(/^skills\/([^/.]+)/))
    .find(m => m);
  if (skillPathMatch && SLUG_RE.test(skillPathMatch[1])) {
    const key = skillPathMatch[1];
    const info = probe(docsBase, key);
    if (info) return { ...info, source: 'diff', confidence: 'medium' };
  }

  // Level 4: single feature dir
  try {
    const dirs = fs.readdirSync(docsBase).filter(d => {
      try {
        return fs.statSync(path.join(docsBase, d)).isDirectory();
      } catch (err) {
        // "Gone between readdir and stat" is a legitimate false. Anything else is a child we
        // could not look at, and swallowing it here bypassed the outer handler entirely — the
        // enumeration then reported `scan_error: false` on a corpus it had not read.
        if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return false;
        throw err;
      }
    });
    if (dirs.length === 1) {
      const info = probe(docsBase, dirs[0]);
      if (info) return { ...info, source: 'single_dir', confidence: 'low' };
    }
  } catch (err) {
    // "docs/features/ doesn't exist" is a result; anything else is a corpus we could not look at,
    // and returning the ordinary `nullResult` would report it as confirmed absence.
    if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) {
      return { ...nullResult, scan_error: true };
    }
  }

  // Level 5: not found
  return nullResult;
}

module.exports = { resolveFeatureContext, SLUG_RE, EMPTY_CANONICAL, EMPTY_CONTEXT };
