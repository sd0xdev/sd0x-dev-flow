#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { resolveDocRole, ROLE_TO_SET, FALLBACK_ROLE, headLines } = require('./doc-metadata');
// The shape lives in a dependency-free module so `scripts/resolve-feature.js` can build the failure
// payload without loading this file. Re-exported below to keep this module's public API unchanged.
const { emptySourceSets } = require('./context-shape');

let _taxonomy = null;

function loadTaxonomy() {
  if (_taxonomy) return _taxonomy;
  const p = path.join(__dirname, '..', 'config', 'doc-taxonomy.json');
  _taxonomy = JSON.parse(fs.readFileSync(p, 'utf8'));
  return _taxonomy;
}

/**
 * Classify a filename against the taxonomy using 7-step precedence.
 * Pure function — no file I/O.
 *
 * @param {string} filename - e.g. "2-tech-spec.md", "checklist-cross-service.md"
 * @param {object} [taxonomy] - Loaded doc-taxonomy.json (auto-loaded if omitted)
 * @returns {{ type: string, namespace: string, confidence: string, is_canonical: boolean }}
 */
function classifyByPath(filename, taxonomy) {
  const tax = taxonomy || loadTaxonomy();
  const types = tax.types;

  // Step 1: exclude check — reject files matching any type's exclude_pattern
  // (checked per-type in later steps)

  // Step 2+3: canonical_filename exact match + exclude
  for (const t of types) {
    if (t.exclude_pattern && new RegExp(t.exclude_pattern).test(filename)) continue;
    if (t.canonical_filename && filename === t.canonical_filename) {
      return { type: t.id, namespace: t.namespace, confidence: 'high', is_canonical: true };
    }
  }

  // Step 4: variant_pattern or semantic_pattern match
  for (const t of types) {
    if (t.exclude_pattern && new RegExp(t.exclude_pattern).test(filename)) continue;
    const pattern = t.variant_pattern || t.semantic_pattern;
    if (pattern && new RegExp(pattern).test(filename)) {
      return { type: t.id, namespace: t.namespace, confidence: 'medium', is_canonical: false };
    }
  }

  // Step 5: lifecycle prefix fallback — /^([0-4])-/
  const prefixMatch = filename.match(/^([0-4])-/);
  if (prefixMatch) {
    const phase = parseInt(prefixMatch[1], 10);
    const lifecycleType = types.find(t => t.namespace === 'lifecycle' && t.phase === phase);
    if (lifecycleType) {
      return { type: lifecycleType.id, namespace: 'lifecycle', confidence: 'medium', is_canonical: false };
    }
  }

  // Step 6: heading_signal — skipped in fast mode (no file I/O here)
  // Step 7: fallback
  return { type: tax.fallback_type, namespace: 'unknown', confidence: 'low', is_canonical: false };
}

/**
 * Classify by heading signals (deep mode). Reads first N lines of a file.
 *
 * @param {string} filePath - Absolute path to .md file
 * @param {object} [taxonomy]
 * @param {number} [maxLines=20]
 * @returns {{ type: string, namespace: string, confidence: string, is_canonical: boolean }|null}
 */
function classifyByHeading(filePath, taxonomy, maxLines) {
  const tax = taxonomy || loadTaxonomy();
  const limit = maxLines || 20;
  let content;
  try {
    const buf = fs.readFileSync(filePath, 'utf8');
    content = buf.split('\n').slice(0, limit).join('\n').toLowerCase();
  } catch { return null; }

  for (const t of tax.types) {
    if (!t.heading_signals || t.heading_signals.length === 0) continue;
    for (const signal of t.heading_signals) {
      if (content.includes(signal.toLowerCase())) {
        return { type: t.id, namespace: t.namespace, confidence: 'low', is_canonical: false };
      }
    }
  }
  return null;
}

/**
 * Split classified items into the four authority-aware source sets.
 *
 * Splitting the output is what makes the tombstone mechanical: a consumer that wants "what does
 * the system do now" reads `current_authority` and physically cannot pick up a frozen design
 * record, where a banner at the top of the file could always be skimmed past.
 *
 * Roles and the review profile each set maps to: docs/features/doc-review-phasing/2-tech-spec.md
 * § 3.1, § 3.2.
 *
 * @param {Array} items - classified entries carrying a `role`
 * @returns {{current_authority: Array, design_records: Array, work_records: Array, history_records: Array}}
 */
function partitionByRole(items) {
  const sets = emptySourceSets();
  for (const item of items) {
    // ROLE_TO_SET is total over the closed role set, and `role` is resolved through the same
    // fail-closed resolver, so the `||` is a belt-and-braces default rather than a live branch.
    const key = ROLE_TO_SET[item.role] || 'current_authority';
    sets[key].push(item);
  }
  return sets;
}

/**
 * Scan a feature docs directory and return full inventory.
 *
 * `doc_inventory` keeps its established meaning — the lifecycle and ancillary docs, with
 * `requests/` excluded. The source sets are additive and DO cover `requests/**`, because a work
 * record is exactly what a request ticket is; the two therefore disagree on that directory by
 * design, and `doc_inventory.length` is unchanged for every existing caller.
 *
 * @param {string} featureDir - Absolute path to docs/features/<key>/
 * @param {object} [taxonomy]
 * @param {object} [options]
 * @param {boolean} [options.deep=false] - Use heading signals for fallback classification
 * @param {object} [options.overrides] - filepath → type overrides
 * @returns {{ doc_inventory: Array, canonical_docs: object, current_authority: Array, design_records: Array, work_records: Array, history_records: Array }}
 */
function scanFeatureDocs(featureDir, taxonomy, options) {
  const tax = taxonomy || loadTaxonomy();
  const opts = options || {};
  const deep = opts.deep || false;
  const overrides = opts.overrides || {};
  const inventory = [];
  const requestItems = [];

  let entries;
  try {
    entries = fs.readdirSync(featureDir, { withFileTypes: true });
  } catch (err) {
    // Same split as `_scanRequests` and `_scanSubdir`, and this is the one that mattered most:
    // a permissions failure on the feature directory itself returned a SUCCESSFUL empty scan, so
    // `probe()` recorded `scan_error: false` and an unreadable corpus was reported as an empty one.
    if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) throw err;
    return {
      doc_inventory: [],
      canonical_docs: pickCanonicalDocs([], tax.canonical_roles),
      ...emptySourceSets(),
    };
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    // `requests/` stays out of doc_inventory and is scanned separately into work_records.
    // A bare `archived/` at the feature root is neither — it is excluded as it always was.
    if (entry.name === 'requests') {
      if (entry.isDirectory()) _scanRequests(featureDir, 'requests', tax, deep, overrides, requestItems);
      continue;
    }
    if (entry.name === 'archived') continue;

    if (entry.isFile() && entry.name.endsWith('.md')) {
      const relPath = entry.name;
      const item = _classifyEntry(relPath, path.join(featureDir, entry.name), tax, deep, overrides);
      inventory.push(item);
    } else if (entry.isDirectory()) {
      // Folder-backed lifecycle phase (e.g. 0-feasibility-study/)
      _scanSubdir(featureDir, entry.name, tax, deep, overrides, inventory);
    }
  }

  const sets = partitionByRole([...inventory, ...requestItems]);

  // Deprecated alias, retained so the existing consumers keep working while they migrate — and
  // "unchanged" has to mean it. Selecting from `current_authority + design_records` looked
  // equivalent (a canonical-role type lands in one of those two by path) and is not: a tech spec
  // declaring `Doc role: History record` leaves both sets, so `canonical_docs.tech_spec` — and the
  // legacy `has_tech_spec` derived from it — would flip to null/false on a document still sitting
  // in the inventory. An alias that changes answers is not an alias. Selected from `inventory`,
  // exactly as before this change; `requestItems` are excluded here for the same reason they were
  // then.
  const canonical_docs = pickCanonicalDocs(inventory, tax.canonical_roles);

  return { doc_inventory: inventory, canonical_docs, ...sets };
}

/** Requests, including `requests/archived/**` — archiving changes visibility, not the role. */
function _scanRequests(featureDir, relDir, tax, deep, overrides, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(featureDir, relDir), { withFileTypes: true });
  } catch (err) {
    // Only "there is no such directory" is confirmed absence. Any other failure — permissions, an
    // I/O error, a path that is not a directory — means the subtree could not be enumerated, and
    // swallowing it would report an unreadable `requests/` as an empty one. Callers turn the throw
    // into an explicit `scan_error`; see `feature-resolver.js` § probe.
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return;
    throw err;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relPath = path.join(relDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(_classifyEntry(relPath, path.join(featureDir, relPath), tax, deep, overrides));
    } else if (entry.isDirectory()) {
      _scanRequests(featureDir, relPath, tax, deep, overrides, out);
    }
  }
}

const READ_CHUNK_BYTES = 8 * 1024;

/**
 * The point past which a "first N lines" read is declared pathological and abandoned.
 *
 * Only a document whose first N lines span more than a megabyte reaches it — nothing in a corpus
 * of prose does. It exists so a generated single-line artifact cannot make role resolution read
 * an arbitrarily large file.
 */
const ROLE_HEAD_MAX_BYTES = 1024 * 1024;

/**
 * Read exactly as much of the file as the head-line contract needs, and say whether it got there.
 *
 * A single fixed-size read was wrong twice over: `readSync` on a regular file may legally return
 * short, and a cap reached mid-document silently truncated the head — so a `2-tech-spec.md` whose
 * first line ran past the cap lost a `Current behavior authority: Yes` sitting on line 3 and fell
 * back to its path role, recreating exactly the placement-versus-obligation disagreement the
 * single-resolution refactor removed. Reading to the Nth newline instead makes the read match the
 * contract rather than approximate it.
 *
 * @returns {{ text: string, complete: boolean }|null} null when the file cannot be read
 */
function _readHead(absPath, wantLines) {
  let fd;
  try {
    fd = fs.openSync(absPath, 'r');
    const chunks = [];
    let newlines = 0;
    let total = 0;
    for (;;) {
      const buf = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      const n = fs.readSync(fd, buf, 0, READ_CHUNK_BYTES, total);
      if (n === 0) return { text: Buffer.concat(chunks).toString('utf8'), complete: true }; // EOF
      chunks.push(buf.subarray(0, n));
      total += n;
      // 0x0A never occurs inside a multi-byte UTF-8 sequence, so counting bytes is exact — and
      // decoding is deferred to the end, so no character is split across a chunk boundary.
      for (let i = 0; i < n; i++) if (buf[i] === 0x0a) newlines++;
      if (newlines >= wantLines) return { text: Buffer.concat(chunks).toString('utf8'), complete: true };
      if (total >= ROLE_HEAD_MAX_BYTES) return { text: Buffer.concat(chunks).toString('utf8'), complete: false };
    }
  } catch { return null; } finally {
    // `finally` and not a second try: an fd leaked once per document would exhaust the table on a
    // large corpus, and the throw that skipped the close is exactly when it matters.
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already gone */ } }
  }
}

/**
 * Resolve the artifact role for one entry: in-document metadata first, path default second.
 *
 * Both failure paths land on `Current authority`, and for one reason: an absence observed through
 * an incomplete window is not evidence of absence. Whether the head was truncated at the abandon
 * point or the file could not be read at all (`EACCES`, `EISDIR`, a transient error), granting a
 * demotion on what was not read would be a guess — and the earlier draft did exactly that, letting
 * an unreadable `2-tech-spec.md` that declares itself live land in `design_records` anyway.
 *
 * `tax` is threaded through so a caller-supplied taxonomy governs roles as well as types —
 * without it the per-repo configuration surface would silently not apply to what it configures.
 */
function _resolveRole(relPath, absPath, tax) {
  const head = _readHead(absPath, headLines(tax));
  if (head === null || !head.complete) return FALLBACK_ROLE;
  // Every path this module builds is relative to the feature directory, never to the repo root, so
  // a `first_segment` rule must not be tested against it — see `roleFromPath`.
  return resolveDocRole(relPath, head.text, tax, { rootRelative: false });
}

function _classifyEntry(relPath, absPath, tax, deep, overrides) {
  const role = _resolveRole(relPath, absPath, tax);

  // Override check — a type override says what KIND of document this is, never whether it owes
  // code alignment, so the role is resolved independently and survives it.
  if (overrides[relPath]) {
    const t = tax.types.find(t => t.id === overrides[relPath]);
    if (t) return { file: relPath, type: t.id, namespace: t.namespace, confidence: 'high', is_canonical: false, role };
  }

  const filename = path.basename(relPath);
  let result = classifyByPath(filename, tax);

  // Deep mode: if fast path returned fallback, try heading signals
  if (deep && result.type === tax.fallback_type) {
    const headingResult = classifyByHeading(absPath, tax);
    if (headingResult) result = headingResult;
  }

  return { file: relPath, ...result, role };
}

function _scanSubdir(featureDir, dirName, tax, deep, overrides, inventory) {
  const subPath = path.join(featureDir, dirName);
  let subEntries;
  try {
    subEntries = fs.readdirSync(subPath, { withFileTypes: true });
  } catch (err) {
    // Same split as `_scanRequests`: absence is a result, unreadability is a failure.
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return;
    throw err;
  }

  // Determine parent phase context from directory name
  const parentType = _inferParentType(dirName, tax);

  for (const sub of subEntries) {
    if (sub.isSymbolicLink()) continue;

    if (sub.isFile() && sub.name.endsWith('.md')) {
      const relPath = path.join(dirName, sub.name);
      const absPath = path.join(subPath, sub.name);
      let item = _classifyEntry(relPath, absPath, tax, deep, overrides);

      // If sub-file classified as a different lifecycle type via prefix fallback,
      // override with parent phase context (folder semantics take precedence)
      if (parentType && item.type !== parentType.id) {
        const isCanonical = parentType.canonical_filename && sub.name === parentType.canonical_filename;
        // `role` is carried across: folder semantics decide the TYPE, and the role was already
        // resolved from the same folder-aware path plus the file's own metadata.
        item = { file: relPath, type: parentType.id, namespace: parentType.namespace, confidence: isCanonical ? 'high' : 'medium', is_canonical: isCanonical, role: item.role };
      }

      inventory.push(item);
    } else if (sub.isDirectory() && sub.name !== 'requests' && sub.name !== 'archived') {
      // Recurse into nested subdirectories, carrying parent type context
      _scanSubdir(featureDir, path.join(dirName, sub.name), tax, deep, overrides, inventory);
    }
  }
}

function _inferParentType(dirName, tax) {
  // Check if dirName matches a lifecycle canonical_dirname or variant_pattern
  for (const t of tax.types) {
    if (t.canonical_dirname && dirName === t.canonical_dirname) return t;
  }
  // Lifecycle prefix fallback for directories
  const prefixMatch = dirName.match(/^([0-4])-/);
  if (prefixMatch) {
    const phase = parseInt(prefixMatch[1], 10);
    return tax.types.find(t => t.namespace === 'lifecycle' && t.phase === phase) || null;
  }
  return null;
}

/**
 * Derive canonical document map from inventory.
 *
 * @param {Array} inventory - Array of { file, type, namespace, confidence, is_canonical }
 * @param {object} canonicalRoles - Map of role → type id (from taxonomy)
 * @returns {object} Map of role → { file, path } | null
 */
function pickCanonicalDocs(inventory, canonicalRoles) {
  const result = {};
  for (const [role, typeId] of Object.entries(canonicalRoles)) {
    const candidates = inventory.filter(i => i.type === typeId);
    if (candidates.length === 0) {
      result[role] = null;
      continue;
    }
    // Priority: is_canonical=true > higher confidence > lexicographic first
    candidates.sort((a, b) => {
      if (a.is_canonical !== b.is_canonical) return a.is_canonical ? -1 : 1;
      const confOrder = { high: 0, medium: 1, low: 2 };
      const ca = confOrder[a.confidence] ?? 3;
      const cb = confOrder[b.confidence] ?? 3;
      if (ca !== cb) return ca - cb;
      return a.file.localeCompare(b.file);
    });
    result[role] = { file: candidates[0].file, path: candidates[0].file };
  }
  return result;
}

module.exports = {
  classifyByPath,
  classifyByHeading,
  scanFeatureDocs,
  pickCanonicalDocs,
  partitionByRole,
  emptySourceSets,
  loadTaxonomy,
};
