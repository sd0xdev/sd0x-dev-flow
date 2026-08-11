'use strict';

/**
 * doc-metadata.js — what kind of document is this, and does it owe code alignment?
 *
 * The review loop used to ask one question of every `.md`: does it match the code. A frozen design
 * record and a live behaviour reference were held to the same obligation, so a request doc written
 * in March was "misaligned" with code written in August — and every such finding cost a round.
 *
 * Resolution mirrors `request-status.js` and is **defined negatively**: a document is exempt from
 * code alignment only when it resolves to a non-authority role. Anything unrecognised — an unknown
 * path, an annotated value, a role nobody has thought of yet — resolves to `Current authority`,
 * which owes the fullest review.
 *
 * That covers *unrecognised* input, and it is not a claim that every error costs only a review too
 * deep. Two known shapes cost one too shallow, both stated where they arise: a promotion written
 * below the preamble is ignored (`_headWindow`), and a raw metadata template placed at the top of a
 * document is indistinguishable from that document's own header (see § Residual there).
 *
 * Roles, path defaults and the metadata format: docs/features/doc-review-phasing/2-tech-spec.md
 * § 3.1. The table itself lives in `scripts/config/doc-taxonomy.json` § doc_roles, so a project
 * whose docs are laid out differently edits config rather than code.
 */

const fs = require('fs');
const path = require('path');

/**
 * Built-in defaults, used when the taxonomy carries no `doc_roles` block — which is what a repo
 * running an older `doc-taxonomy.json` looks like. Falling back to the shipped table rather than
 * to "no rules at all" keeps the feature working there; "no rules" would resolve every document to
 * `Current authority`, which is safe but inert.
 */
const BUILTIN_ROLE_CONFIG = {
  closed_set: ['Current authority', 'Design record', 'Work record', 'History record'],
  fallback: 'Current authority',
  path_defaults: [
    { name: 'work-records', role: 'Work record', scope: 'segment', pattern: '^requests$' },
    { name: 'history-records', role: 'History record', scope: 'segment', pattern: '^(review-log-|adr-)' },
    { name: 'design-records', role: 'Design record', scope: 'segment', pattern: '^[0-3]-(feasibility|requirements|tech-spec|architecture)' },
    { name: 'implementation-record', role: 'Current authority', scope: 'segment', pattern: '^4-implementation' },
    { name: 'instruction-surface', role: 'Current authority', scope: 'first_segment', pattern: '^(skills|rules|agents|commands)$' },
  ],
  metadata: { head_lines: 30, role_key: 'Doc role', authority_key: 'Current behavior authority' },
};

/** The role every unresolved path and unrecognised value lands on. Deepest obligation. */
const FALLBACK_ROLE = 'Current authority';

/**
 * The role set and the fallback are part of the CONTRACT, not part of the configuration.
 *
 * `path_defaults` and `metadata` are the per-repo surface; these two are not, because a config
 * that could edit them could exempt documents wholesale — `fallback: "Design record"` alone would
 * clear the obligation from every path matching no rule, and a fifth invented role would be
 * exempt by construction, since owing alignment is defined as *being* `Current authority`.
 * A config that disagrees here is ignored, which is the fail-closed direction.
 */
const CONTRACT_ROLES = ['Current authority', 'Design record', 'Work record', 'History record'];

/** Same window as `request-status.js`: metadata is front-matter-shaped or it is not metadata. */
const HEAD_LINES = 30;

/** The source set a role belongs to in `scanFeatureDocs`'s output. */
const ROLE_TO_SET = {
  'Current authority': 'current_authority',
  'Design record': 'design_records',
  'Work record': 'work_records',
  'History record': 'history_records',
};

let _roleConfig = null;

/**
 * Load § doc_roles from the taxonomy. Reads the config file directly rather than through
 * `doc-classifier.loadTaxonomy` — that module requires this one, and the cycle would leave one of
 * the two holding a half-initialised export object.
 *
 * @param {object} [taxonomy] - an already-loaded doc-taxonomy.json, to avoid a second read
 * @returns {object} the role config, never null
 */
function loadRoleConfig(taxonomy) {
  if (taxonomy) return taxonomy.doc_roles || BUILTIN_ROLE_CONFIG;
  if (_roleConfig) return _roleConfig;
  try {
    const p = path.join(__dirname, '..', 'config', 'doc-taxonomy.json');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    _roleConfig = parsed.doc_roles || BUILTIN_ROLE_CONFIG;
  } catch { _roleConfig = BUILTIN_ROLE_CONFIG; }
  return _roleConfig;
}

/**
 * The closed set of roles. Exact membership after trimming — the same discipline
 * `CLOSED_REQUEST_STATUS` uses, and for the same reason: a field consumers compare exactly cannot
 * also be a place for commentary. `Design record (mostly)` is not a member — and non-membership is
 * not absence: `parseDocRole` returns `null`, `parseDocRoleState` marks the declaration `invalid`,
 * and `resolveDocRole` fails closed to `Current authority`. Only a document that declares NOTHING
 * falls through to the path default.
 *
 * The `taxonomy` parameter is accepted for symmetry with the rest of the module and is
 * deliberately ignored: the set is contract, not configuration. See CONTRACT_ROLES.
 *
 * @returns {Set<string>}
 */
function docRoles() {
  return new Set(CONTRACT_ROLES);
}

/** Always the fail-closed role. Config cannot move it — see CONTRACT_ROLES. */
function fallbackRole() {
  return FALLBACK_ROLE;
}

/**
 * The configured head-line count — the window inside which metadata is metadata.
 *
 * Validated as a positive finite integer, not merely coerced. `Number(x) || HEAD_LINES` accepted
 * `0.5`, which made the bounded read stop after one newline while `slice(0, 0.5)` kept zero lines
 * — so a first-line promotion vanished and the document stayed exempt. A configuration surface
 * that can silently hide metadata is a configuration surface that can grant an exemption.
 */
function headLines(taxonomy) {
  const cfg = loadRoleConfig(taxonomy);
  const n = cfg.metadata && cfg.metadata.head_lines;
  return Number.isSafeInteger(n) && n > 0 ? n : HEAD_LINES;
}

// A metadata line: a blockquote whose content is exactly `**Key**: value`. Up to three leading
// spaces, which is what CommonMark allows before a block marker — a fourth makes it an indented
// code block, and then it is content rather than a declaration. The same allowance applies to the
// heading, so a document written with an indented title does not silently lose its declaration.
// The key admits a lone `*` but never an embedded `**`. `[^*]+` was too narrow — it rejected a
// configured key holding `*` before `_esc` could keep its literal-match promise, and a rejected
// line never enters the preamble, so a `Yes` promotion vanished and the document kept an
// exemption. Plain `.+?` was too wide in the other direction: it backtracks across delimiters, so
// `> **Note** and **more**: text` parses as the single key `Note** and **more` and a prose
// blockquote keeps the preamble open. `\*(?!\*)` is the line between the two — one `*` is a
// character, two are the delimiter. A key containing `**`, or ending in `*`, is therefore not
// representable at all; `_configuredKey` refuses it outright rather than matching nothing.
const _KEY = String.raw`(?:[^*]|\*(?!\*))+`;
const _METADATA_LINE = new RegExp(`^ {0,3}>\\s*\\*\\*${_KEY}\\*\\*\\s*:.*$`);
const _ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;

/**
 * The document's metadata preamble: the contiguous run of metadata-shaped blockquote lines at the
 * very top, after any blank lines and at most one ATX heading. Nothing below it is metadata.
 *
 * **Why this shape and not a Markdown parser.** Skipping the constructs that hold illustrations —
 * fences, then HTML comments, then raw-HTML blocks — kept finding another construct, because the
 * honest version of that approach is a CommonMark block parser. Anchoring to the top answers the
 * same question structurally: an illustration sits below whatever introduces it, and the first
 * non-metadata line ends the block, so no construct has to be recognised. Rationale and the
 * rounds behind it: docs/features/doc-review-phasing/2-tech-spec.md § 3.1.
 *
 * Two costs, both asserted in `test/scripts/doc-metadata.test.js` rather than left to be found:
 *
 * 1. Metadata below the preamble is not read, including a `Yes` promotion — so the miss is not
 *    always toward the deeper obligation. The authoring contract is "put it at the top".
 * 2. **Residual.** A raw metadata template placed at the top *is* read as a declaration; a
 *    blockquote is both the declaration syntax and a way to display one, so the two are not
 *    decidable apart. Show templates inside a fence — every one in this corpus already is.
 * 3. **Residual.** A malformed *authority* line falls through, unlike a malformed role line. The
 *    two are not symmetric on purpose: an unreadable `No` that falls through REFUSES an exemption
 *    (fail-closed), and an annotated `No — until Step 4 lands` falling through is the documented
 *    behaviour this repo's own tech spec relies on. Only an unreadable `Yes` loses anything, and
 *    what it loses is a promotion to a DEEPER review the author asked for — bounded, and repaired
 *    by writing the documented format. Making it fail-closed would reclassify every annotated `No`
 *    in the corpus, which is a spec change, not a fix.
 */
function _headWindow(source, taxonomy) {
  // Split on all three line-ending conventions rather than on `\n`. A CRLF document otherwise
  // leaves a trailing `\r` on every line, and a trailing `\r` defeats any `$`-anchored match.
  // A UTF-8 BOM is invisible to an author and fatal to every `^`-anchored match below: with one in
  // front, the first line is neither a heading nor a metadata line, the loop breaks immediately,
  // and a document declaring `Current behavior authority: Yes` silently resolves to its path
  // default — a promotion lost, which is the fail-OPEN direction this module exists to avoid.
  const text = typeof source === 'string' && source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = String(text).split(/\r\n|\r|\n/).slice(0, headLines(taxonomy));
  const out = [];
  let headingSeen = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    // Stored without its leading indent, so the value readers below can stay anchored on `^>`.
    if (_METADATA_LINE.test(line)) { out.push(line.trimStart()); continue; }
    if (out.length > 0) break;          // the block has started; anything else ends it
    if (line.trim() === '') continue;   // blank lines above the block are fine
    if (!headingSeen && _ATX_HEADING.test(line)) { headingSeen = true; continue; }
    break;                              // any other content at the top: there is no block
  }
  return out.join('\n');
}

// Escaped so a configured key containing regex metacharacters is matched literally.
const _esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A key that cannot be written on one metadata line: it collides with the delimiter, or breaks it. */
const _KEY_UNUSABLE = /\*\*|\r|\n/;

/**
 * The configured key, the built-in one when nothing is configured, or `null` when what *is*
 * configured cannot be written in the format — `**` inside it collides with the delimiter around
 * it, a trailing `*` runs into it, and a line terminator cannot occur in a single line at all.
 *
 * `null` is a refusal, not a fallback, and `resolveDocRole` turns it into `Current authority` for
 * the whole document. Two milder policies were considered and both leave the dangerous direction
 * open: matching nothing drops every promotion written with the configured key, and substituting
 * the built-in key does the same while additionally re-enabling a key the repo was trying to
 * replace. Neither makes a declaration written the configured way readable, so neither is safe —
 * the honest answer to "I cannot read this repo's declarations" is the deepest obligation, which
 * is also loud: every document lands in `current_authority` until the config is fixed.
 */
function _configuredKey(cfg, field, builtin) {
  const raw = cfg.metadata ? cfg.metadata[field] : undefined;
  if (raw === undefined || raw === null) return builtin;
  if (typeof raw !== 'string' || raw === '' || raw.endsWith('*') || _KEY_UNUSABLE.test(raw)) return null;
  return raw;
}

/**
 * Every `> **<key>**: <value>` in the head window, in order. Case-insensitive on the KEY only.
 *
 * All of them, not the first: a document carrying two contradictory declarations is ambiguous,
 * and which one a regex happens to reach first is not a policy. The callers below decide, and
 * they decide toward the deeper obligation.
 */
function _blockquoteValues(source, key, taxonomy) {
  if (!source) return [];
  // `(.*?)`, not `(.+?)`: an empty value (`> **Doc role**:`) is a declaration the author WROTE and
  // this parser cannot read. Requiring one character made it indistinguishable from writing no
  // declaration at all, so it took the path default — the fail-open direction. It reaches the
  // caller as a present-but-empty value and is classified `invalid` there.
  const re = new RegExp(`^>\\s*\\*\\*${_esc(key)}\\*\\*\\s*:\\s*(.*?)\\s*$`, 'gim');
  return [..._headWindow(source, taxonomy).matchAll(re)].map((m) => m[1].trim());
}

/**
 * How many lines of the leading blockquote run *name* this key in key position — including the
 * ones the strict value reader rejected. Compared against the strict reader's count by the caller:
 * a mismatch means at least one declaration was written and could not be read.
 *
 * Counting, not a boolean, because the boolean only worked when the strict reader found nothing.
 * `> **Doc role**: Work record` followed by `> **Doc role** History record` gave it one strict
 * value and it never looked further — so the same two lines resolved differently depending on
 * which came first.
 *
 * @param {string} source full document text
 * @param {string} key configured key text
 * @param {object} [taxonomy]
 * @returns {number}
 */
function _headKeyMentions(source, key, taxonomy) {
  if (!source) return 0;
  // Anchored immediately after the blockquote marker, and the key must be followed by a BOUNDARY —
  // whitespace, `*`, `:`, or end of line. Unanchored, `> **Note**: Use **Doc role**: X here`
  // counted as a declaration; with no boundary at all, `> **Doc roleplay**: X` did. Both then
  // forced `Current authority` on a document that declared nothing.
  // A boundary, not a required delimiter. Requiring a following `*` or `:` missed the combined
  // omission — `> **Doc role Work record`, and `> **Doc role` at end of line — which is exactly the
  // shape an author produces by forgetting the closing `**` and the colon together. The boundary
  // is whitespace, `*`, `:`, or end of line.
  const re = new RegExp(`^ {0,3}>\\s*\\*{1,2}\\s*${_esc(key)}(?=[\\s*:]|$)`, 'i');
  // A line that is a well-formed declaration of an UNRELATED key is that key's line, not a garbled
  // one of ours: with a configured key of `Doc role`, `> **Status**: Draft` must not count.
  //
  // "Unrelated" is the load-bearing word, and it was missing at first. A bold phrase that BEGINS
  // with the configured key is ambiguous — `> **Doc role Work record**:` is far more likely a
  // misplaced closing `**` than a genuine key named "Doc role Work record" — and excluding it let
  // exactly that common typo resolve to the path default. Prefix ambiguity therefore counts as a
  // mention and fails closed. The cost is a real key of the form `<our key><space>…` being read as
  // a garbled declaration; that costs a deeper review, which is the side to be wrong on.
  const otherKey = new RegExp(`^ {0,3}>\\s*\\*\\*((?:[^*]|\\*(?!\\*))+)\\*\\*\\s*:`);
  const keyPrefix = new RegExp(`^${_esc(key)}(?=[\\s*:]|$)`, 'i');
  const text = typeof source === 'string' && source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = String(text).split(/\r\n|\r|\n/).slice(0, headLines(taxonomy));
  let headingSeen = false;
  let started = false;
  let count = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^ {0,3}>/.test(line)) {
      started = true;
      const m = otherKey.exec(line);
      const isOtherKey = m && !keyPrefix.test(m[1].trim());
      if (!isOtherKey && re.test(line)) { count += 1; continue; }
      // Not our key. The preamble continues only through lines that are still metadata; arbitrary
      // blockquote prose ENDS it, exactly as `_headWindow` ends it. Scanning on through prose made
      // the two readers disagree: `> Note: this is a spec.` followed by a perfectly valid
      // `> **Doc role**: Work record` gave one mention and zero values — read as a garbled
      // declaration, so a tech spec opening with a quoted note resolved to `Current authority`.
      // Fail-closed is the right direction for an unreadable declaration, not for a document whose
      // declaration simply sits below the preamble; that one is ABSENT, and absent means the path.
      if (_METADATA_LINE.test(line)) continue;
      break;
    }
    if (started) break;                 // the leading blockquote run ended
    if (line.trim() === '') continue;
    if (!headingSeen && _ATX_HEADING.test(line)) { headingSeen = true; continue; }
    break;                              // any other content at the top: there is no preamble
  }
  return count;
}

/**
 * Path defaults, ordered, first match wins. Every rule is matched **per path segment**, so the
 * function works on a repo-relative path (`docs/features/x/requests/a.md`) or a feature-relative
 * one (`requests/a.md`) — which is what lets `scanFeatureDocs` classify entries it only knows
 * relatively. `first_segment` rules read the first segment alone.
 *
 * That last sentence is exactly where the two path shapes stop being interchangeable, and
 * `rootRelative: false` is how a caller says which one it holds. `first_segment` means *repo root*
 * segment — `skills` is a root directory of instruction surfaces and is nothing at all as a folder
 * inside a feature — so on a feature-relative path the first segment is not the thing the rule
 * asks about, and matching it there makes a rule written for `skills/**` also claim
 * `docs/features/<key>/skills/**`. The shipped rule resolves to the fallback role, which hid this
 * for as long as nobody used the configuration surface the taxonomy advertises. Segment-scoped
 * rules are unaffected: they ask about every segment, and every segment of a feature-relative path
 * really is one.
 *
 * @param {string} p path with `/` separators
 * @param {object} [taxonomy]
 * @param {object} [opts]
 * @param {boolean} [opts.rootRelative=true] false when `p` is relative to a feature directory
 * @returns {string} a member of the closed role set
 */
function roleFromPath(p, taxonomy, opts) {
  const fallback = fallbackRole(taxonomy);
  if (typeof p !== 'string' || p === '') return fallback;
  const rootRelative = !opts || opts.rootRelative !== false;
  // Both separators. The scan builds relative paths with `path.join`, so on Windows they arrive
  // here with backslashes; split on `/` alone, `requests\\archived\\old.md` is ONE segment, misses
  // the exact `^requests$` rule and resolves to `Current authority` instead of `Work record`.
  // Portability lives here rather than in the scanner: changing what the scanner *returns* would
  // be an output-schema change, and every caller already expects platform-native paths.
  const segments = p.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) return fallback;

  const cfg = loadRoleConfig(taxonomy);
  const roles = docRoles(taxonomy);
  const rules = Array.isArray(cfg.path_defaults) ? cfg.path_defaults : BUILTIN_ROLE_CONFIG.path_defaults;

  for (const rule of rules) {
    if (!rule || !rule.pattern || !roles.has(rule.role)) continue;
    let re;
    // A malformed pattern in config must not take the whole scan down with it — skip the rule and
    // let the remaining ones decide, which fails toward the deeper obligation.
    try { re = new RegExp(rule.pattern); } catch { continue; }
    if (rule.scope === 'first_segment' && !rootRelative) continue;
    const scope = rule.scope === 'first_segment' ? [segments[0]] : segments;
    if (scope.some((s) => re.test(s))) return rule.role;
  }
  return fallback;
}

/**
 * @param {string} source full document text
 * @param {object} [taxonomy]
 * @returns {string|null} an exact member of the closed set, or null when absent/unrecognised
 */
function parseDocRoleState(source, taxonomy) {
  const cfg = loadRoleConfig(taxonomy);
  const key = _configuredKey(cfg, 'role_key', 'Doc role');
  // Unusable config: nothing in this document is readable, so no declaration can be ruled out.
  if (key === null) return { state: 'invalid', role: null };

  const raw = _blockquoteValues(source, key, taxonomy);
  // A line that NAMES the key inside the preamble but misses the grammar — no colon, one asterisk
  // instead of two, the bold run unclosed — is a declaration the author wrote and this parser
  // cannot read. Counting it as `absent` handed it the path default, so `> **Doc role** Work
  // record` bought a tech spec the shallower `Design record` by omitting a character.
  const mentions = _headKeyMentions(source, key, taxonomy);
  if (mentions === 0) return { state: 'absent', role: null };
  // Every mention must have been readable. Checked whatever `raw.length` is, so a malformed line
  // is not masked by a well-formed one standing before it.
  if (mentions !== raw.length) return { state: 'invalid', role: null };

  const roles = docRoles(taxonomy);
  const valid = raw.filter((v) => roles.has(v));
  // Present but unreadable, in any of its shapes: an annotated value, a typo, an empty value, two
  // different roles, or one good line beside one bad one. All of them are `invalid`, NOT `absent`.
  // Collapsing them into `absent` is what let a garbled declaration take the PATH default — and
  // for a tech spec that default is `Design record`, i.e. a shallower obligation obtained by
  // writing something the parser could not read. Fail-closed means a declaration nobody can read
  // costs the document the deepest role, not the cheapest.
  if (valid.length !== raw.length) return { state: 'invalid', role: null };
  if (valid.some((v) => v !== valid[0])) return { state: 'invalid', role: null };
  return { state: 'valid', role: valid[0] };
}

/**
 * @param {string} source full document text
 * @param {object} [taxonomy]
 * @returns {string|null} an exact member of the closed set, or null when absent/unrecognised
 */
function parseDocRole(source, taxonomy) {
  return parseDocRoleState(source, taxonomy).role;
}

/**
 * The explicit authority declaration, which overrides the role's implication **in both
 * directions** — a tech spec that really is the living behaviour reference says so and is reviewed
 * as one; a `4-implementation.md` superseded by a rewrite says so and stops being one.
 *
 * `Yes` / `No` and nothing else. An annotated `No — until Step 4 lands` is deliberately
 * unparseable: reading a prose sentence as a boolean is how a document talks its way out of a
 * review.
 *
 * @param {string} source full document text
 * @param {object} [taxonomy]
 * @returns {boolean|null} null when absent or not exactly `Yes`/`No`
 */
function parseAuthorityFlag(source, taxonomy) {
  const cfg = loadRoleConfig(taxonomy);
  const key = _configuredKey(cfg, 'authority_key', 'Current behavior authority');
  if (key === null) return null;   // unusable config: nothing here is readable
  // British spelling accepted on the shipped key, since the value is what carries meaning.
  const values = _blockquoteValues(source, key, taxonomy);
  if (key === 'Current behavior authority') {
    values.push(..._blockquoteValues(source, 'Current behaviour authority', taxonomy));
  }
  // ANY `Yes` promotes, whatever else the document says and in whichever spelling. Reading only
  // the first match let a `No` above a `Yes` — or an American spelling above a British one —
  // decide, so the documented promotion rule turned on line order.
  if (values.some((v) => /^yes$/i.test(v))) return true;
  if (values.some((v) => /^no$/i.test(v))) return false;
  return null;
}

/**
 * The single resolution. Source-set placement and the alignment obligation are both derived from
 * it, so the two cannot disagree. Precedence, highest first:
 *
 * | # | Condition | Role |
 * |---|-----------|------|
 * | 1 | authority `Yes` | `Current authority` — promotion wins, so a conflicting pair resolves safe |
 * | 2 | `Doc role: <exact member>` | that role |
 * | 3 | path default | § doc_roles `path_defaults`, then `Current authority` |
 * | 4 | authority `No`, applied last, demoting **only** a `Current authority` result | `History record` |
 *
 * Step 4 demotes; it does not assign a category. Why that distinction matters, and why the two
 * answers were collapsed into one: docs/features/doc-review-phasing/2-tech-spec.md § 3.1, and the
 * cases in `test/scripts/doc-metadata.test.js`.
 *
 * @param {string} p path with `/` separators
 * @param {string} [source] full document text; omit for a path-only decision
 * @param {object} [taxonomy]
 * @param {object} [opts] forwarded to `roleFromPath` — `{rootRelative: false}` for a
 *   feature-relative path, which is what `scanFeatureDocs` holds
 * @returns {string} a member of the contract role set
 */
function resolveDocRole(p, source, taxonomy, opts) {
  // An unusable key config means declarations cannot be read at all, so no exemption may rest on
  // their absence — including the path defaults, which would otherwise hand out three of the four
  // roles while the one mechanism that overrides them is broken. See `_configuredKey`.
  const cfg = loadRoleConfig(taxonomy);
  if (_configuredKey(cfg, 'role_key', 'Doc role') === null) return FALLBACK_ROLE;
  if (_configuredKey(cfg, 'authority_key', 'Current behavior authority') === null) return FALLBACK_ROLE;

  const flag = parseAuthorityFlag(source, taxonomy);
  if (flag === true) return FALLBACK_ROLE;

  // A declaration that is present but unreadable resolves HERE and stops. It does not reach the
  // path default (which is often shallower) and it does not reach the `No` demotion below —
  // otherwise an unreadable role line plus `No` would exempt the document entirely, which is the
  // cheapest way out of a review that this module can be asked to produce. `No` withdraws an
  // authority claim; there is no claim to withdraw when the document's own role line is garbage.
  const declared = parseDocRoleState(source, taxonomy);
  if (declared.state === 'invalid') return FALLBACK_ROLE;

  const role = declared.role || roleFromPath(p, taxonomy, opts);

  if (flag === false && role === FALLBACK_ROLE) return 'History record';
  return role;
}

/**
 * Does this document owe alignment with the current code? Exactly one role does.
 *
 * @param {string} p path with `/` separators
 * @param {string} [source] full document text
 * @param {object} [taxonomy]
 * @returns {boolean}
 */
function owesCodeAlignment(p, source, taxonomy) {
  return resolveDocRole(p, source, taxonomy) === FALLBACK_ROLE;
}

module.exports = {
  BUILTIN_ROLE_CONFIG,
  CONTRACT_ROLES,
  FALLBACK_ROLE,
  HEAD_LINES,
  ROLE_TO_SET,
  loadRoleConfig,
  docRoles,
  fallbackRole,
  headLines,
  roleFromPath,
  parseDocRole,
  parseDocRoleState,
  parseAuthorityFlag,
  resolveDocRole,
  owesCodeAlignment,
};
