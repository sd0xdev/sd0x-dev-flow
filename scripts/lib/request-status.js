'use strict';

/**
 * request-status.js — the single contract for reading a request doc's `Status`.
 *
 * Three consumers had grown three incompatible readings of the same field:
 *
 *   | consumer                                | window     | case        | conventions accepted        |
 *   |-----------------------------------------|------------|-------------|-----------------------------|
 *   | `scripts/lib/fc-extractor.js`           | 30 lines   | insensitive | blockquote, heading, table  |
 *   | `skills/next-step/scripts/analyze.js`   | whole doc  | sensitive   | table, blockquote           |
 *   | `skills/create-request/SKILL.md` (prose)| 15 lines   | —           | —                           |
 *
 * and — the reason this module exists rather than a comment asking people to keep three copies in
 * sync — three different ideas of which values mean "still open". `analyze.js` carried a positive
 * list of four (`pending`, `in development`, `in progress`, `nearly complete`). Measured against
 * the 125 request docs actually in this repo, that list missed `Candidate Complete` (20 docs, the
 * third most common value) and `Spec Complete` (1), while `In Development` and `Nearly Complete`
 * matched nothing at all. So `request-stale` was blind to 21 open requests and `feature-complete`
 * could fire while they were outstanding.
 *
 * The fix is not "add the two missing strings" — that leaves the next value to be forgotten the
 * same way. Openness is defined NEGATIVELY here, exactly as `filterOpenRequests` already
 * documented it: a request is closed only if its Status is one of a short, exhaustive, closed set;
 * anything else — including a value nobody has thought of yet — is open. Unrecognised reads as
 * open, which errs toward reporting work that is finished rather than hiding work that is not.
 *
 * `OPEN_REQUEST_STATUS` is the observed open vocabulary. It is documentation and test material,
 * NOT the predicate: nothing branches on membership in it.
 */

/**
 * Exhaustive. A value must appear here to count as closed, matched by exact equality after
 * trimming — an annotated `Completed (superseded below)` is deliberately NOT closed, because a
 * field that consumers compare exactly cannot also be a place for commentary.
 */
const CLOSED_REQUEST_STATUS = new Set(['Completed', 'Done', 'Superseded', 'Archived']);

/** Observed open vocabulary across this repo's request docs. Descriptive, not load-bearing. */
const OPEN_REQUEST_STATUS = new Set([
  'Pending',
  'In Progress',
  'In Development',
  'Nearly Complete',
  'Candidate Complete',
  'Spec Complete',
]);

/**
 * Lines scanned from the top of the document. Measured, not guessed: of the 125 request docs in
 * this repo, zero carry their Status below line 30, so the window costs no coverage while keeping
 * a `## Status:` heading deep in a long body from being mistaken for front-matter.
 */
const HEAD_LINES = 30;

// The three conventions request docs actually use. Case-insensitive on the word "Status" only.
const STATUS_BLOCKQUOTE_RE = /^>\s*\*\*status\*\*\s*:\s*(.+?)\s*$/im;
const STATUS_HEADING_RE = /^#{1,6}\s*status\s*:\s*(.+?)\s*$/im;
// The cell is matched with a NEGATED CLASS, not `\s*(.+?)\s*`. The old form put three quantifiers
// over the same run of characters — and because `.` matches whitespace, `\s*`, `(.+?)` and the
// second `\s*` all competed for it. When the closing `|` never arrives (a `| Status |` row whose
// line is padded and unterminated) the engine enumerates every way to split that run: measured
// cubic, 294ms at 800 characters, ~20s at a few KB. A request doc is read from disk by
// `next-step` and `fc-extractor`, so one malformed row stalls the tool.
//
// A markdown table cell cannot contain `|`, so `[^|\n]+` gives every character exactly one
// possible owner and the backtracking space collapses to nothing. `+` (not `*`) preserves the old
// requirement of at least one character, so `| Status ||` still reads as "no Status field" rather
// than as an empty one.
const STATUS_TABLE_RE = /^\|\s*status\s*\|([^|\n]+)\|/im;
// Bold is stripped from the already-extracted cell rather than by a second, competing regex:
// `| Status | **Completed** |` must yield `Completed`, not `**Completed**` — closure is decided by
// exact equality, so the asterisks would reopen the request. Running it on a bounded, trimmed cell
// keeps it linear by construction and removes the ordering subtlety of two whole-line patterns.
const BOLD_CELL_RE = /^\*\*(.*)\*\*$/;

/**
 * Parse the Status value from the head of a request doc.
 *
 * @param {string} source full document text
 * @returns {string|null} the trimmed value, or null when no Status field is present
 */
function parseRequestStatus(source) {
  if (!source) return null;
  const head = source.split('\n').slice(0, HEAD_LINES).join('\n');
  const bq = head.match(STATUS_BLOCKQUOTE_RE);
  if (bq) return bq[1].trim();
  const hd = head.match(STATUS_HEADING_RE);
  if (hd) return hd[1].trim();
  const tb = head.match(STATUS_TABLE_RE);
  if (!tb) return null;
  const cell = tb[1].trim();
  const bold = BOLD_CELL_RE.exec(cell);
  return bold ? bold[1].trim() : cell;
}

/**
 * @param {string|null|undefined} status
 * @returns {boolean} true only for an exact member of CLOSED_REQUEST_STATUS
 */
function isClosedRequestStatus(status) {
  return typeof status === 'string' && CLOSED_REQUEST_STATUS.has(status.trim());
}

/**
 * Whether a request with this Status is still open.
 *
 * A null/absent Status counts as OPEN: "no Status field" and "Status says nothing closed" are the
 * same statement about whether the work is finished, and treating an unlabelled request as done
 * is the failure this whole module exists to prevent.
 *
 * @param {string|null|undefined} status
 * @returns {boolean}
 */
function isOpenRequestStatus(status) {
  return !isClosedRequestStatus(status);
}

module.exports = {
  parseRequestStatus,
  isClosedRequestStatus,
  isOpenRequestStatus,
  CLOSED_REQUEST_STATUS,
  OPEN_REQUEST_STATUS,
  HEAD_LINES,
};
