'use strict';

const fs = require('fs');
const path = require('path');

// Status parsing and the closed/open taxonomy live in ONE module, because three consumers had
// grown three incompatible readings of the same field — see scripts/lib/request-status.js.
const {
  parseRequestStatus,
  isClosedRequestStatus,
  CLOSED_REQUEST_STATUS,
} = require('./request-status');

const AC_DOMAIN_KEYWORDS = {
  security: [
    'auth', 'authz', 'password', 'token', 'secret',
    'xss', 'csrf', 'ssrf', 'injection',
    'redaction', 'pii', 'encryption',
    'signature verification', 'access control',
  ],
  'data-integrity': [
    'transaction', 'consistency', 'idempotent',
    'migration', 'rollback', 'data loss',
    'no duplicate', 'no drop', 'atomic',
  ],
  regression: [
    'regression', 'must not break', 'backward compatible',
    'existing behavior', 'no regression',
  ],
};

// Relaxed to absorb real-world variance: optional numeric prefix, optional
// MoSCoW/qualifier suffix after the bare heading, and an optional hyphen in
// "Non-Functional". See existing in-repo docs for the variants this covers.
const SECTION_HEADINGS = {
  fr: /^##\s+(?:\d+\.\s+)?Functional Requirements\b/im,
  nfr: /^##\s+(?:\d+\.\s+)?Non[-\s]?Functional Requirements\b/im,
  ac: /^##\s+Acceptance Criteria\b/im,
};

/**
 * Extract a section body given the start heading. Section ends at the next
 * heading of same level or EOF.
 *
 * @param {string} source
 * @param {RegExp} startRe
 * @returns {{ body: string, startLine: number } | null}
 */
function extractSection(source, startRe) {
  const match = source.match(startRe);
  if (!match || match.index == null) return null;
  const afterStart = source.slice(match.index + match[0].length);
  const nextMatch = afterStart.match(/^##\s+/m);
  const body = nextMatch ? afterStart.slice(0, nextMatch.index) : afterStart;
  const startLine = source.slice(0, match.index).split('\n').length;
  return { body, startLine };
}

const FR_ROW_RE = /^\|\s*(FR-\d+[a-z]?)\s*\|\s*(.+?)\s*\|\s*(Must|Should|Could|Won't)\s*\|\s*(.*?)\s*\|/i;
const NFR_ROW_RE = /^\|\s*(NFR-\d+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*(.*?)\s*\|/;
// AC rows accept either an explicit `AC-\d+` prefix (spec §3.4.2 format) or
// synthetic ordinal IDs when absent. The explicit form is preferred because
// downstream parsers match on explicit IDs and silently diverge from
// position-based synthetics when the doc re-orders checkboxes.
const AC_ROW_RE = /^[-*]\s+\[\s*([xX\s])\s*\]\s+(?:(AC-\d+)\s*[:\-–]?\s*)?(.+?)\s*$/;

/**
 * Parse FR rows from a table body.
 *
 * @param {string} body
 * @param {string} sourceDoc - relative path to the source doc
 * @param {number} sectionStartLine - 1-indexed line where section heading appears
 * @returns {Array<object>}
 */
function parseFrRows(body, sourceDoc, sectionStartLine) {
  const items = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(FR_ROW_RE);
    if (!m) continue;
    items.push({
      id: m[1],
      type: 'FR',
      source_doc: sourceDoc,
      source_line: sectionStartLine + i,
      text: m[2].trim(),
      priority: m[3],
      rationale: m[4] ? m[4].trim() : '',
      domains: [],
    });
  }
  return items;
}

/**
 * Parse NFR rows from a table body.
 *
 * @param {string} body
 * @param {string} sourceDoc
 * @param {number} sectionStartLine
 * @returns {Array<object>}
 */
function parseNfrRows(body, sourceDoc, sectionStartLine) {
  const items = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(NFR_ROW_RE);
    if (!m) continue;
    items.push({
      id: m[1],
      type: 'NFR',
      source_doc: sourceDoc,
      source_line: sectionStartLine + i,
      text: m[3].trim(),
      category: m[2].trim(),
      metric: m[4] ? m[4].trim() : '',
      domains: [],
    });
  }
  return items;
}

/**
 * Parse AC checkbox list. Checkboxes without explicit IDs get synthetic
 * AC-1, AC-2, ... per source doc.
 *
 * @param {string} body
 * @param {string} sourceDoc
 * @param {number} sectionStartLine
 * @returns {Array<object>}
 */
function parseAcRows(body, sourceDoc, sectionStartLine) {
  const items = [];
  const lines = body.split('\n');

  // First pass: gather explicit AC-N ids so synthetic ordinals can skip them
  // and never collide. Without this step a doc mixing `- [ ] AC-3: foo` with
  // a bare `- [ ] bar` two rows down would produce two items both claiming
  // id `AC-3`, which in turn corrupts composite-key lookups in the aggregator.
  const explicitIds = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(AC_ROW_RE);
    if (m && m[2]) explicitIds.add(m[2]);
  }

  let synth = 0;
  const nextSynthId = () => {
    do { synth += 1; } while (explicitIds.has(`AC-${synth}`));
    return `AC-${synth}`;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(AC_ROW_RE);
    if (!m) continue;
    const explicitId = m[2];
    const text = m[3];
    items.push({
      id: explicitId || nextSynthId(),
      type: 'AC',
      source_doc: sourceDoc,
      source_line: sectionStartLine + i,
      text,
      checked: m[1].toLowerCase() === 'x',
      domains: classifyAcDomains(text),
    });
  }
  return items;
}

/**
 * Classify AC text into prohibited-domain categories (per tech-spec §3.4.4.1).
 * An AC may match multiple domains.
 *
 * @param {string} text
 * @returns {string[]}
 */
function classifyAcDomains(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matched = [];
  for (const [domain, keywords] of Object.entries(AC_DOMAIN_KEYWORDS)) {
    const hit = keywords.some(kw => lower.includes(kw));
    if (hit) matched.push(domain);
  }
  return matched;
}


/**
 * List open-status request docs under a directory. A request is "open" if its
 * Status is not in CLOSED_REQUEST_STATUS, or if it has no Status field.
 *
 * @param {string} requestsDir - absolute path to requests/ directory
 * @returns {string[]} absolute paths of open request docs, sorted
 */
function filterOpenRequests(requestsDir) {
  if (!requestsDir) return [];
  let entries;
  try {
    entries = fs.readdirSync(requestsDir);
  } catch {
    return [];
  }
  const open = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const abs = path.join(requestsDir, name);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile()) continue;
    let content;
    try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const status = parseRequestStatus(content);
    if (!isClosedRequestStatus(status)) {
      open.push(abs);
    }
  }
  return open.sort();
}

/**
 * Classify the feature spec state given a canonical_docs object from
 * feature-resolver.js.
 *
 * @param {object|null} canonicalDocs
 * @returns {'unresolved' | 'no-spec' | 'partial-spec' | 'full-spec'}
 */
function classifySpecState(canonicalDocs) {
  if (!canonicalDocs) return 'unresolved';
  const hasReq = canonicalDocs.requirements != null;
  const hasSpec = canonicalDocs.tech_spec != null;
  if (!hasReq && !hasSpec) return 'no-spec';
  if (hasReq && hasSpec) return 'full-spec';
  return 'partial-spec';
}

/**
 * Resolve a canonical-doc entry from feature-resolver into an absolute path.
 * Entries may be strings or `{ file, path }` objects (current resolver shape).
 *
 * @param {string} featureDir - absolute path to feature directory
 * @param {*} entry
 * @returns {string|null}
 */
function resolveCanonicalPath(featureDir, entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return path.join(featureDir, entry);
  if (entry.path) return path.join(featureDir, entry.path);
  if (entry.file) return path.join(featureDir, entry.file);
  return null;
}

/**
 * Extract FR/NFR/AC items from lifecycle docs for a single feature.
 *
 * @param {object} params
 * @param {string} params.repoRoot - absolute repo root
 * @param {string} params.featureKey - feature slug
 * @param {object|null} params.canonicalDocs - from feature-resolver
 * @param {string[]} [params.includedRequests] - absolute paths; if omitted, derived via filterOpenRequests
 * @returns {{ items: Array<object>, specState: string, sources: object, requestsIncluded: string[] }}
 */
function extractItems(params) {
  const { repoRoot, featureKey, canonicalDocs } = params;
  const featureDir = path.join(repoRoot, 'docs', 'features', featureKey);
  const specState = classifySpecState(canonicalDocs);

  const sources = { requirements: null, tech_spec: null };
  const items = [];

  const reqAbs = resolveCanonicalPath(featureDir, canonicalDocs && canonicalDocs.requirements);
  if (reqAbs) {
    const rel = path.relative(repoRoot, reqAbs);
    sources.requirements = rel;
    try {
      const src = fs.readFileSync(reqAbs, 'utf8');
      const fr = extractSection(src, SECTION_HEADINGS.fr);
      if (fr) items.push(...parseFrRows(fr.body, rel, fr.startLine));
      const nfr = extractSection(src, SECTION_HEADINGS.nfr);
      if (nfr) items.push(...parseNfrRows(nfr.body, rel, nfr.startLine));
    } catch { /* keep item list empty */ }
  }

  const specAbs = resolveCanonicalPath(featureDir, canonicalDocs && canonicalDocs.tech_spec);
  if (specAbs) {
    sources.tech_spec = path.relative(repoRoot, specAbs);
  }

  const requestsDir = path.join(featureDir, 'requests');
  const included = Array.isArray(params.includedRequests)
    ? params.includedRequests.slice()
    : filterOpenRequests(requestsDir);

  const requestsIncluded = [];
  for (const abs of included) {
    const rel = path.relative(repoRoot, abs);
    requestsIncluded.push(rel);
    try {
      const src = fs.readFileSync(abs, 'utf8');
      const ac = extractSection(src, SECTION_HEADINGS.ac);
      if (ac) items.push(...parseAcRows(ac.body, rel, ac.startLine));
    } catch { /* skip unreadable request */ }
  }

  return { items, specState, sources, requestsIncluded };
}

module.exports = {
  extractItems,
  classifyAcDomains,
  filterOpenRequests,
  classifySpecState,
  parseRequestStatus,
  AC_DOMAIN_KEYWORDS,
  CLOSED_REQUEST_STATUS,
};
