'use strict';

/**
 * The resolver payload's shape, and nothing else.
 *
 * **This file must never `require` anything.** It exists so `scripts/resolve-feature.js` can build
 * the failure payload without loading the code whose failure it is reporting. The wrapper used to
 * import `EMPTY_CONTEXT` from `feature-resolver`, which pulls in `doc-classifier`, the taxonomy
 * loader and the metadata parser — so a syntax error or a missing module anywhere in that graph
 * killed the wrapper at load time, exit 1, no JSON at all. That is precisely the failure the
 * `scan_error: true` contract is for, and the wrapper was inside the blast radius of it.
 *
 * A dependency-free module is not immune — a syntax error *here* still kills every importer — but
 * it is one small file with no logic and no I/O, against a graph that reads configuration off disk.
 * `test/skills/scan-error-gate.test.js` pins both the absence of requires here and the wrapper's
 * import list, so re-introducing the coupling fails rather than silently re-arming the hole.
 */

/** The `canonical_docs` alias shape. Deprecated and role-blind — see § 3.2 of the tech spec. */
const EMPTY_CANONICAL = () => ({
  tech_spec: null, architecture: null, feasibility: null, requirements: null,
});

/** The shape every source set carries when a scan finds nothing. */
const emptySourceSets = () => ({
  current_authority: [], design_records: [], work_records: [], history_records: [],
});

/**
 * The result shape when nothing resolved. Both CLIs and the wrapper emit the *same* object on
 * their exceptional exits: a bare `{}` is not this shape and not any shape — every consumer's
 * `result.current_authority.map(...)` is a TypeError on exactly the paths where it is hardest to
 * diagnose. `scan_error` defaults to false (nothing resolved is a result); a caller that could not
 * enumerate overrides it to true.
 */
const EMPTY_CONTEXT = () => ({
  key: null, source: 'none', confidence: null, docs_path: null,
  doc_inventory: [], canonical_docs: EMPTY_CANONICAL(), ...emptySourceSets(),
  scan_error: false, has_tech_spec: false, has_requirements: false, has_requests: false,
});

/**
 * The keys a payload must carry to be a payload at all. The wrapper validates against this before
 * passing a child's stdout through: "parseable JSON" is too weak a contract, since `7`, `[]` and
 * `{"scan_error":false}` all parse and none of them is something a consumer can read the source
 * sets out of.
 */
const SOURCE_SET_KEYS = Object.freeze([
  'current_authority', 'design_records', 'work_records', 'history_records',
]);

const CANONICAL_KEYS = Object.freeze(['tech_spec', 'architecture', 'feasibility', 'requirements']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStringOrNull = (v) => v === null || typeof v === 'string';

/**
 * Is `value` the whole agreed payload? Structural only — it does not judge the *contents*, because
 * an empty corpus and a full one are equally valid answers. What it refuses is anything a consumer
 * could trip over.
 *
 * **Every** top-level field is checked, not just the ones a TypeError would obviously come from.
 * The first version checked `scan_error`, `doc_inventory` and the four sets, and therefore passed a
 * six-array object with no `key`, `source`, `docs_path`, `canonical_docs` or `has_*` booleans — a
 * payload the wrapper's own documentation calls "the full shape". A partial object that satisfies
 * the checks a reviewer happened to think of is the `{}` failure wearing more fields.
 * `canonical_docs` is checked down to its four named keys for the same reason: the alias is
 * deprecated but still read, and `canonical_docs.tech_spec` on a bare `{}` is `undefined`, which
 * reads as "no tech spec" rather than as a broken payload.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isContextShape(value) {
  if (!isPlainObject(value)) return false;
  if (typeof value.scan_error !== 'boolean') return false;
  if (typeof value.source !== 'string') return false;
  if (!isStringOrNull(value.key)) return false;
  if (!isStringOrNull(value.confidence)) return false;
  if (!isStringOrNull(value.docs_path)) return false;
  if (!Array.isArray(value.doc_inventory)) return false;
  if (!SOURCE_SET_KEYS.every((k) => Array.isArray(value[k]))) return false;
  if (!['has_tech_spec', 'has_requirements', 'has_requests'].every((k) => typeof value[k] === 'boolean')) {
    return false;
  }
  if (!SOURCE_SET_KEYS.every((k) => value[k].every(isEntry))) return false;
  if (!value.doc_inventory.every(isEntry)) return false;
  if (!isPlainObject(value.canonical_docs)) return false;
  return CANONICAL_KEYS.every((k) => k in value.canonical_docs
    && (value.canonical_docs[k] === null || isCanonicalEntry(value.canonical_docs[k])));
}

/**
 * A classified document entry. Only `file` is enforced, because `file` is what every consumer
 * reads and interpolates into a link; the rest of the entry (`type`, `role`, …) is advisory to a
 * skill and adding a field must not invalidate an older payload.
 *
 * "It is an array" was the previous bar, and an array of arbitrary values cleared it — so
 * `design_records: [1, 2]` was a valid payload and `entry.file` was `undefined` in a Markdown link.
 */
function isEntry(v) {
  return isPlainObject(v) && isNonEmptyString(v.file);
}

/**
 * Non-empty *after trimming*, because `''` is a string and `[<title>](<empty>)` is a link to the
 * current document — and `'   '` is the same link with the length check satisfied. A payload naming
 * a document with no filename is the `undefined`-in-a-link failure wearing a passing type check.
 */
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * A `canonical_docs` value: the resolver emits `{file, path}` and both are strings. `{}`,
 * `{file: 7}` and `{path: 'x'}` all used to pass as "an object", which is the same
 * `undefined`-in-a-link failure one level down — and `has_tech_spec` is derived from this map being
 * non-null, so a malformed entry reads as "there is a tech spec" while naming no file.
 */
function isCanonicalEntry(v) {
  return isPlainObject(v) && isNonEmptyString(v.file) && isNonEmptyString(v.path);
}

module.exports = {
  EMPTY_CANONICAL, emptySourceSets, EMPTY_CONTEXT, SOURCE_SET_KEYS, CANONICAL_KEYS, isContextShape,
};
