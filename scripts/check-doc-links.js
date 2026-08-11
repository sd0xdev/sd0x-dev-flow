#!/usr/bin/env node
'use strict';

/**
 * Resolve the repo-local **file** targets of Markdown links, and report the ones that do not exist —
 * alongside a count of the link-shaped constructs this scanner could not classify.
 *
 * **Heading fragments are out of scope.** `[x](./a.md#frag)` is checked as a link to `a.md` with the
 * `#frag` dropped; `[x](#frag)` names no file and leaves uncounted, exactly as an external URL does.
 * The boundary is a measured result, not a shortcut — what it cost and what it removed:
 * `docs/features/doc-review-phasing/4-implementation.md` § 1.8.
 *
 * **Advisory input, never a gate**: the exit code is 0 whatever it finds. It hands the reviewer facts
 * it would otherwise spend a pass rediscovering. `markdownlint` does not resolve links.
 *
 * **It does not claim completeness**, and `unresolved` is what makes that honest: this repository
 * ships zero dependencies, so a construct with no CommonMark parser to defer to is *reported* as
 * declined rather than silently absent. Narrowing is therefore free; only inventing a finding is
 * forbidden, because a finding reaches the reviewer as established fact.
 *
 * **The promise holds only if every lossy step reaches the counter**, which is why nothing here edits
 * the text before it is counted: each step returns a *range*, and `targetsOf` takes one inventory of
 * raw `](` candidates and gives each exactly one of three outcomes.
 *
 * Contract: `docs/features/doc-review-phasing/2-tech-spec.md` § 3.4, § 4 Step 4. Why ranges rather
 * than a pre-pass, what each producer proves, and the round-by-round archaeology:
 * `docs/features/doc-review-phasing/4-implementation.md` § 1.7.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Anything with a scheme, a protocol-relative host, or a mail target is somebody else's to resolve. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
/**
 * A placeholder is a link whose target is filled in by a generator or by the reader, so resolving it
 * against this checkout answers nothing. `{FEATURE}`, `<feature-name>` and `${ROOT}` are the three
 * spellings the templates in `skills/**` actually use.
 */
const TEMPLATED = /[{}]|\$[A-Za-z{]|<[^>]*>/;

function escaped(text, index) {
  let slashes = 0;
  for (let n = index - 1; n >= 0 && text[n] === '\\'; n -= 1) slashes += 1;
  return slashes % 2 === 1;
}

/**
 * The text with `ranges` blanked to spaces — a link inside `code` is a description of one, not one.
 *
 * Length is preserved so an offset into the result indexes the original unchanged, and newlines
 * survive so line arithmetic and the destination grammar (which rejects one) still see the shape of
 * the document. The ranges are produced once, by `inlineOpaque`, and consulted here and by the
 * accounting in `targetsOf`; recomputing them in two places is how the two disagreed.
 */
function maskRanges(text, ranges, base = 0) {
  // `split('')`, not `[...text]`: every offset in this file is a UTF-16 index, and spreading splits
  // by code point. One emoji earlier in a README shifted the whole mask by a unit, which blanked the
  // characters next to six live links instead of the code spans, and reported them as unclassified.
  const chars = text.split('');
  for (const r of ranges) {
    const from = Math.max(r.from - base, 0);
    const to = Math.min(r.to - base, text.length);
    for (let k = from; k < to; k += 1) if (chars[k] !== '\n') chars[k] = ' ';
  }
  return chars.join('');
}

/** The `[` that opens this `](` — a `]` with no live opener before it is not a link. */
function hasLabelOpener(text, closeIndex) {
  let depth = 0;
  for (let n = closeIndex - 1; n >= 0; n -= 1) {
    if (escaped(text, n)) continue;
    if (text[n] === ']') { depth += 1; continue; }
    if (text[n] === '[') { if (depth === 0) return true; depth -= 1; }
  }
  return false;
}

/**
 * CommonMark destinations may escape their own delimiters; the filesystem sees the unescaped name.
 * The set is the whole ASCII punctuation range the spec makes escapable — a shorter list silently
 * leaves the backslash in the path, and `a\&b.md` then reports a dead link to a file that exists.
 */
const ESCAPABLE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
function unescapeDestination(text) {
  return text.replace(ESCAPABLE, '$1');
}

/**
 * A link destination beginning at `i` — `<…>` or a balanced bare run — as `{target, end}`, or
 * `null` if it is not one. Shared by inline links and reference definitions, because two copies of
 * this grammar is how `[notes]: <a b.md>` came to resolve as a link to `a`.
 */
function readDestination(text, i) {
  if (text[i] === '<') {
    let end = i + 1;
    while (end < text.length && !(text[end] === '>' && !escaped(text, end))) {
      if (text[end] === '\n') return null;
      end += 1;
    }
    if (end >= text.length) return null;
    return { target: unescapeDestination(text.slice(i + 1, end)), end: end + 1 };
  }
  let depth = 0;
  let k = i;
  for (; k < text.length; k += 1) {
    if (escaped(text, k)) continue;
    const c = text[k];
    if (c === '(') { depth += 1; continue; }
    if (c === ')') { if (depth === 0) break; depth -= 1; continue; }
    if (/\s/.test(c)) break;
  }
  if (depth !== 0) return null;
  return { target: unescapeDestination(text.slice(i, k)), end: k };
}

/**
 * A `"…"`, `'…'` or `(…)` title beginning at `i`, as `{end}` past its closing delimiter, or `null`.
 * One copy, shared by inline links and reference definitions — "starts with a quote" is not the same
 * question as "is a closed title", and answering the first was how `[a]: x.md "unterminated` kept
 * resolving.
 */
function readTitle(text, i) {
  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== '(') return null;
  const closer = quote === '(' ? ')' : quote;
  let end = i + 1;
  while (end < text.length && !(text[end] === closer && !escaped(text, end))) end += 1;
  return end >= text.length ? null : { end: end + 1 };
}

/**
 * The optional title and the `)` that closes an inline link, starting at `i`; the index of that `)`
 * or `null`. Both destination forms go through it — the angle form used to accept any later `)`,
 * so `[x](<a.md> "unterminated)` and `[x](<a.md> garbage)` both resolved.
 */
function readInlineClose(text, i) {
  let t = i;
  while (t < text.length && /\s/.test(text[t])) t += 1;
  if (text[t] === ')') return t;
  // CommonMark requires whitespace between a destination and its title, so `[x](<a.md>"t")` is not
  // a link at all. Resolving `a.md` out of it invents a `dead-link` against a path nobody wrote.
  if (t === i) return null;
  const title = readTitle(text, t);
  if (!title) return null;
  let after = title.end;
  while (after < text.length && /\s/.test(text[after])) after += 1;
  return text[after] === ')' ? after : null;
}

/**
 * Inline link and image destinations in one block, as `{target, offset}`, found by scanning rather
 * than by regex.
 *
 * A regex has to fix a nesting depth, and CommonMark does not: `[x](a(b(c)).md)` is one valid link
 * whose target a one-level pattern skips entirely. Skipping is the dangerous direction — the prompt
 * downstream reads an empty `failures` array as proof every link resolves, so a target this function
 * never returns is reported as checked and passing.
 *
 * Reporting the wrong direction is the other hazard: a `](` inside a code span, with no `[` opening
 * it, or with an unterminated title is not a link, and a finding raised on one reaches the reviewer
 * as a fact already established.
 *
 * The unit is the block, not the line, because neither construct stops at a newline: a label split
 * over two lines loses its opener when scanned per line, and a code span opened on one line and
 * closed on the next leaves the first line unmasked — which invents a finding rather than missing
 * one. A blank line is the boundary, since it ends both constructs.
 */
function matchesIn(text) {
  const found = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== ']' || text[i + 1] !== '(' || escaped(text, i)) continue;
    if (!hasLabelOpener(text, i)) continue;
    let j = i + 2;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    const dest = readDestination(text, j);
    if (!dest) continue;
    const close = readInlineClose(text, dest.end);
    if (close === null) continue;
    // `opener` is the `]` the candidate inventory counted, so the accounting can match a classified
    // target back to the candidate it came from. `offset` locates the destination, for the line.
    found.push({ target: dest.target, offset: j, opener: i });
    i = close;
  }
  return found;
}

/**
 * The same, for a standalone string: find its opaque ranges first, then read what survives.
 *
 * Normalized once, so range production, masking and parsing all read one string — the inner passes
 * normalize their own copy, and applying those offsets to a CRLF original shears the mask off its
 * span, which invents a target out of code. The positions handed back are then mapped onto the
 * string the **caller** passed: an offset the caller cannot slice with is not a location.
 */
function inlineMatches(block, cells = false) {
  const toRaw = rawOffsetMapper(block);
  const text = normalizeEol(block);
  return matchesIn(maskRanges(text, inlineOpaque(text, cells)))
    .map((m) => ({ ...m, offset: toRaw(m.offset), opener: toRaw(m.opener) }));
}

/** The targets alone, for callers that do not need to locate them. */
function inlineTargets(block) {
  return inlineMatches(block).map((m) => m.target);
}

/** The label of a reference definition: `[label]: `, with the destination left to the shared parser. */
const REF_LABEL = /^ {0,3}\[(?:[^\]\n\\]|\\.)+\]:[ \t]*/;

/**
 * A `[label]:` line the strict grammar above declines because a container carries it — quoted, or
 * inside a list item. CommonMark allows both; this scanner does not model where those containers
 * end, so such a line is **counted**, never parsed. Without it the definition simply disappeared and
 * the document read as though it had one fewer link to check.
 *
 * The separator after the colon is **optional**, exactly as in the strict grammar above: `[x]:a.md`
 * is a definition. Requiring one meant `> [x]:missing.md` matched neither inventory and left with no
 * exit at all — a definition that vanished from a document reporting `unresolved: 0`.
 */
const REF_LABEL_LOOSE = /^ {0,3}(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?\[(?:[^\]\n\\]|\\.)+\]:[ \t]*/;

/** A reference definition's target, or `null` when the line is not one. */
function referenceTarget(line) {
  const label = REF_LABEL.exec(line);
  if (!label) return null;
  const dest = readDestination(line, label[0].length);
  if (!dest || !dest.target) return null;
  // A destination may be followed by a **closed** title and by nothing else. `[a]: b.md and prose`
  // is a paragraph that opens with brackets; `[a]: b.md "unterminated` and `[a]: b.md "t" junk` are
  // not definitions either. Resolving a target out of any of them is a guess reported as a fact.
  const rest = line.slice(dest.end);
  if (rest.trim() === '') return dest.target;
  const lead = rest.length - rest.trimStart().length;
  if (lead === 0) return null; // same separation rule as an inline title
  const title = readTitle(rest, lead);
  return title && rest.slice(title.end).trim() === '' ? dest.target : null;
}

/**
 * A fenced-code opener with its info string, and a closer, which carries none.
 *
 * Two grammar rules decide whether a line is a fence at all, and one pattern for both got each of
 * them wrong in the direction that misleads. A backtick fence's info string may not contain a
 * backtick, so ` ```bad`info ` opens nothing and the "example" under it is live Markdown that went
 * unscanned. A closing fence is the marker and nothing else, so accepting trailing text let
 * ` ``` not-a-close ` end the block early and exposed the code inside it as prose.
 */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** The marker a line opens a fence with, or `null` if it opens none. */
function fenceOpener(line) {
  const m = FENCE_OPEN.exec(line);
  if (!m) return null;
  return m[1][0] === '`' && m[2].includes('`') ? null : m[1];
}


/** A bullet or ordered list marker at the left margin — what opens an item whose content is indented. */
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]/;

/** A line with its leading whitespace expanded to columns — a tab advances to the next multiple of 4. */
function expandTabs(line) {
  const lead = /^[ \t]*/.exec(line)[0];
  let col = 0;
  for (const ch of lead) col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
  return ' '.repeat(col) + line.slice(lead.length);
}

/** The offset each line starts at, so a line-based pass can speak in raw-source coordinates. */
function lineOffsets(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

/**
 * The code blocks a line-based pass can settle — fenced and indented — as raw-source ranges.
 *
 * This replaced a `stripFences` pre-pass, and the replacement is the point rather than a tidy-up.
 * Blanking fences before anything was counted put a lossy step *outside* the accounting: a candidate
 * the pre-pass removed never reached an exit, so a document could report `unresolved: 0` having
 * silently lost a real link. A range is a fact the classifier consults; a blanked line is evidence
 * destroyed.
 *
 * Indented code is recognised only where CommonMark lets it start — after a blank line, or after
 * another indented line. Four spaces under a paragraph is a lazy continuation and under a list marker
 * is the item's own content; both are prose and both hold real links. Measured across the 544 tracked
 * documents: **no** link candidate sits on an indented line at all, so the rule costs nothing it
 * could have found, and it closes the `    [x](missing.md)` that a fence-only scan called live.
 */
/**
 * CRLF input reaches every line-anchored predicate as a line ending in `\r`, and `$`-anchored
 * grammar (the table delimiter, fence closers, tag-alone) rejects it — a valid GFM table was not
 * confirmed, and the cross-cell span it should have prevented erased a live link. A **lone** CR is
 * a line ending to CommonMark too, and unhandled it fuses the whole document into one line, so the
 * rewrite takes both. Normalizing at each per-source entry keeps every internal coordinate on one
 * consistent text; findings carry line numbers, which the rewrite cannot shift.
 */
function normalizeEol(source) {
  return source.includes('\r') ? source.replace(/\r\n?/g, '\n') : source;
}

/**
 * Map an offset in the normalized text back onto the string the caller passed. The rewrite only
 * ever *drops* the `\r` of a `\r\n` pair (a lone `\r` becomes `\n` in place, shifting nothing), so
 * a normalized offset is the raw offset minus the pairs before it — walked once, here.
 */
function rawOffsetMapper(raw) {
  if (!raw.includes('\r')) return (offset) => offset;
  const drops = [];
  let removed = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\r' && raw[i + 1] === '\n') {
      drops.push(i - removed);
      removed += 1;
      i += 1;
    }
  }
  return (offset) => {
    let n = 0;
    while (n < drops.length && drops[n] < offset) n += 1;
    return offset + n;
  };
}

function codeBlockRegions(source) {
  source = normalizeEol(source);
  const lines = source.split('\n');
  const starts = lineOffsets(source);
  const regions = [];
  let marker = null;
  let from = 0;
  let prevBlank = true;
  let indented = false;
  // The last non-blank line that was **not** part of an indented run — the context the run sits in.
  let lastContent = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const end = starts[i] + line.length;
    if (marker !== null) {
      const close = FENCE_CLOSE.exec(line);
      const closes = close && close[1][0] === marker[0] && close[1].length >= marker.length;
      // An unclosed fence runs to the end of the document — that is the spec, not a fallback.
      if (closes || i === lines.length - 1) { regions.push({ from, to: end, proven: true }); marker = null; }
      continue;
    }
    const opener = fenceOpener(line);
    if (opener) { marker = opener; from = starts[i]; indented = false; prevBlank = false; lastContent = line; continue; }
    // A fence inside a blockquote is still a fence, and reading only the bare line let its contents
    // out as live Markdown. Where the container ends is what this scanner does not model, so the
    // region is consumed but **not** proven: its candidates are counted rather than dropped.
    const open = unwrap(line);
    const quoted = containerFence(line, open.depth);
    if (quoted) {
      // Two bounds, and the earlier one wins. The **container**: a line no longer carrying the
      // opener's own prefix is outside it, so the region stops there whatever the fence is doing —
      // running past it masked a real heading below the quote and called the link to it dead. The
      // **fence**: a closer is the same marker character at least as long, so ` ``` ` does not close a
      // ```` fence and the link it still hides is not exposed as live Markdown.
      let end = i;
      for (let k = i + 1; k < lines.length; k += 1) {
        const rest = stripQuotes(lines[k], open.depth);
        if (rest === null) break;
        end = k;
        // `stripQuotes` already drops up to three leading spaces and `FENCE_CLOSE` allows three
        // more, which covers every container content column a real document uses. Stripping the
        // rest as well would decide the ambiguous cases beyond that, and this scanner does not
        // model content columns — so the region simply runs longer and its candidates are counted.
        const closer = FENCE_CLOSE.exec(rest);
        if (closer && closer[1][0] === quoted[0] && closer[1].length >= quoted.length) break;
      }
      regions.push({ from: starts[i], to: starts[end] + lines[end].length, proven: false });
      i = end;
      indented = false;
      prevBlank = false;
      lastContent = lines[end];
      continue;
    }
    if (line.trim() === '') { prevBlank = true; continue; } // a blank line does not end indented code
    // Indentation is measured in **columns**, over the whole leading whitespace run. A tab advances
    // to the next multiple of four, so ` \t[x](y.md)` reaches column four and is indented code —
    // expanding only a tab run anchored at offset zero left that line looking like prose, and the
    // example inside it was resolved against the filesystem and reported dead.
    if (/^ {4,}/.test(expandTabs(line)) && (prevBlank || indented)) {
      // Four columns is code only at the document's own left margin. Inside a list item the same
      // indentation is the item's **continuation paragraph**, and this scanner has no list model to
      // tell which — so where the preceding non-blank line is itself a marker or already indented,
      // the region is consumed but not proven and its candidates are counted. Proving it would drop
      // a live link out of the accounting entirely, which is the one outcome the three-way exit
      // exists to prevent.
      const container = lastContent !== null && (LIST_MARKER.test(lastContent) || /^[ \t]/.test(lastContent));
      indented = true;
      regions.push({ from: starts[i], to: end, proven: !container });
    } else {
      indented = false;
      lastContent = line;
    }
    prevBlank = false;
  }
  return regions;
}

/** The region containing `at`, or `null` — regions never overlap, so the first hit is the answer. */
function regionAt(regions, at) {
  for (const r of regions) if (at >= r.from && at < r.to) return r;
  return null;
}

/** Where a table cell ends: the next unescaped `|`, or the end of the row. */
function cellEnd(text, i) {
  for (let k = i + 1; k < text.length; k += 1) {
    if (text[k] === '\n') return k;
    if (text[k] === '|' && !escaped(text, k)) return k;
  }
  return text.length;
}

/**
 * The opaque inline ranges in one block — code spans and HTML comments — as raw-source offsets.
 *
 * Left to right, so whichever construct opens first owns the text after it. Looking for one and then
 * the other is what let a backtick *inside* a comment open a span, and a `<!--` inside a code span
 * open a comment. It also settles Codex's `Before <!-- [x](missing.md) --> after`: a comment is found
 * wherever it starts, not only at the head of a line, which is where the old block-level rule looked.
 *
 * A code span is **proven** only when it opens and closes on one line. Across a newline the container
 * decides — a nested list item's backtick cannot close the parent paragraph's span — and this scanner
 * does not model containers, so the span is `uncertain` and the candidates inside it are counted
 * rather than dropped. The earlier version answered this question by walking the masked text for
 * surrounding spaces, which stopped at the first space the original already had; the range is now
 * carried rather than reconstructed, so there is nothing left to lose it.
 *
 * An HTML comment is proven either way: nothing inside one parses as a link, and an unterminated one
 * runs to the end of the document.
 */
function opaqueRanges(source, blocks, code) {
  source = normalizeEol(source);
  const out = [];
  const blockOf = (i) => blocks.find((b) => i >= b.from && i < b.from + b.text.length) || null;
  const lines = source.split('\n');
  const starts = lineOffsets(source);
  /**
   * The offset past the container that holds `at`, or `null` at depth 0. A comment opened inside a
   * blockquote ends with the quote: searching the whole source consumed `> <!--` through an
   * unquoted `-->` two lines below and swallowed the live link between them, reporting nothing.
   */
  const lineIndexOf = (at) =>
    starts.findIndex((from, n) => at >= from && (n + 1 === starts.length || at < starts[n + 1]));
  const containerEnd = (at) => {
    const i = lineIndexOf(at);
    if (i === -1) return null;
    const depth = unwrap(lines[i]).depth;
    if (depth === 0) return null;
    let end = i;
    while (end + 1 < lines.length && stripQuotes(lines[end + 1], depth) !== null) end += 1;
    return starts[end] + lines[end].length;
  };
  /**
   * Whether the line holding `at` is **list-carried** — a list marker, or leading indentation that
   * may be an item's content column. A multi-line comment opened on such a line has an extent this
   * scanner does not model: `- <!--` through an unmarked `-->` swallowed the *sibling* item between
   * them, and its live link left the report with nothing counted. Such a range is consumed
   * unproven, so its candidates are declined rather than decided.
   */
  const listCarried = (at) => {
    const i = lineIndexOf(at);
    if (i === -1) return false;
    const line = lines[i];
    const depth = unwrap(line).depth;
    const rest = stripQuotes(line, depth);
    if (rest === null) return false;
    return LIST_MARKER.test(rest) || /^[ \t]/.test(depth === 0 ? line : rest);
  };
  let i = 0;
  while (i < source.length) {
    const inCode = regionAt(code, i);
    if (inCode) { i = inCode.to; continue; }
    // A comment is scanned over the whole source, never per block, because it does not stop at one:
    // `<!-- …` on one line and `-->` two lines below a `>` quote is one comment in CommonMark. Doing
    // this per block is what left the blockquote line between them exposed as live Markdown.
    if (source.startsWith('<!--', i)) {
      // `end` is the **real** terminator, kept apart from every effective bound below: comparing an
      // already-truncated extent against a bound let a container edge or EOF land exactly on the
      // block end and masquerade as a `-->` that was never there.
      const close = source.indexOf('-->', i + 4);
      const end = close === -1 ? null : close + 3;
      // GFM splits cells before inline parsing, so an unescaped `|` ends the cell whatever is open
      // in it. A comment that does not close inside its cell is therefore literal text — exactly the
      // rule spans below already obey. Letting it run to `-->` carried it across the pipe and erased
      // the next cell's link with nothing counted.
      const cellBlock = blockOf(i);
      if (cellBlock && cellBlock.table && (end === null || cellEnd(source, i) < end)) { i += 4; continue; }
      // An opener with content before it on its line is an **inline** construct, owned by its leaf
      // block: a comment beginning inside a paragraph cannot reach past the heading that interrupts
      // it, and unterminated it is literal text. A terminator past the block's end is decided by
      // what stands between: only decisive blocks — the comment could not have continued, literal;
      // any skipped block or unproven code region — the block's own end is not settled (a lazy line
      // may be this very paragraph, closing the comment over the candidates), so the extent up to
      // the block end is consumed unproven and its candidates are declined.
      const li = lineIndexOf(i);
      const pre = li === -1 ? '' : source.slice(starts[li], i);
      if (pre.replace(CONTAINER_PREFIX, '').replace(LIST_MARKER, '').trim() !== '') {
        if (end === null) { i += 4; continue; }
        const blockEnd = cellBlock ? cellBlock.from + cellBlock.text.length : i;
        if (end <= blockEnd) {
          // cmark-gfm's comment grammar: the text may not start with `>` or `->`, contain `--`,
          // or end with `-`. `<!-- a <!-- -->` is therefore no comment from the first opener — the
          // real one starts later, and proving the wide range swallowed the live link before it.
          // A failed opener is literal text, and the scan continues into the body it freed.
          const body = source.slice(i + 4, close);
          if (body.startsWith('>') || body.startsWith('->') || body.includes('--') || body.endsWith('-')) {
            i += 4;
            continue;
          }
          out.push({ from: i, to: end, proven: true });
          i = end;
          continue;
        }
        // Only what stands **directly** at the block's edge decides: a blank line or a decisive
        // block there ends the paragraph outright, comment literal, whatever lies further on. A
        // skipped block or unproven code region there is a lazy line that may be this very
        // paragraph — closing the comment over the candidates — so nothing is provable.
        const after = blockOf(blockEnd + 1);
        const afterCode = regionAt(code, blockEnd + 1);
        // `blocksOf` splits on the broad leaf grammar, but an ordered marker other than 1 cannot
        // interrupt a paragraph — its "block" may really be this paragraph's next line, with the
        // terminator closing the comment over the candidates. Same-depth ordered-not-1 at the edge
        // is therefore ambiguity, not decisiveness.
        let afterOrdered = false;
        if (after !== null && !after.skipped) {
          const afterLine = source.slice(after.from).split('\n')[0];
          const d2 = unwrap(afterLine).depth;
          const c2 = stripQuotes(afterLine, d2);
          // The marker keeps its 0–3 spaces of indentation inside the quote, and interruption is
          // decided by the marker's **number**, not its spelling — `01.` is start number 1.
          const m = c2 === null ? null : /^ {0,3}(\d{1,9})[.)][ \t]/.exec(c2);
          afterOrdered = d2 === unwrap(lines[li]).depth && m !== null && Number(m[1]) !== 1;
        }
        const ambiguous = (after !== null && (after.skipped || afterOrdered))
          || (afterCode !== null && !afterCode.proven);
        if (!ambiguous) { i += 4; continue; }
        out.push({ from: i, to: blockEnd, proven: false });
        i = blockEnd;
        continue;
      }
      const bound = containerEnd(i);
      let to = end === null ? source.length : end;
      if (bound !== null && bound < to) to = bound;
      out.push({ from: i, to, proven: !source.slice(i, to).includes('\n') || !listCarried(i) });
      i = to;
      continue;
    }
    if (source[i] !== '`' || escaped(source, i)) { i += 1; continue; }
    let n = 1;
    while (source[i + n] === '`') n += 1;
    // A span, unlike a comment, *is* bounded by its block — a stray backtick in one list item must
    // not swallow the next item's link. And in a confirmed table row it is bounded by the cell, which
    // GFM splits first: `` `Generated[ -](by\|with)` `` survives only because that pipe is escaped.
    const block = blockOf(i);
    let limit = block ? block.from + block.text.length : i + n;
    if (block && block.table) limit = Math.min(limit, cellEnd(source, i));
    let end = -1;
    for (let j = i + n; j < limit;) {
      if (source[j] !== '`') { j += 1; continue; }
      let k = 1;
      while (source[j + k] === '`') k += 1;
      if (k === n) { end = j; break; }
      j += k;
    }
    if (end === -1) { i += n; continue; } // an unmatched run is literal backticks, not an opener
    out.push({ from: i, to: end + n, proven: !source.slice(i, end + n).includes('\n') });
    i = end + n;
  }
  return out;
}

/** The same over a standalone string, which is its own single block. */
function inlineOpaque(text, cells = false) {
  return opaqueRanges(text, [{ from: 0, text, table: cells, skipped: false }], []);
}




/**
 * A line that starts a new leaf block, so whatever preceded it cannot extend across it: an ATX
 * heading, a list item, a blockquote, a thematic break, a setext underline.
 *
 * A table row is **not** here. Its rows have to stay in one block for the delimiter row to be
 * findable at all, and a leading `|` is not evidence of a table — `| a | b |` in prose is a
 * paragraph. Cell boundaries are handled by masking instead, once the block is confirmed.
 *
 * This is what keeps the block from being "every run of non-blank lines". A stray backtick in one
 * list item would otherwise open a code span that swallows the next item's link, and the missing
 * target is then reported as checked and passing. The list is a **subset** of CommonMark's leaf
 * blocks, chosen so that every entry only ever *narrows* a block: narrowing can lose a construct
 * that legitimately spans one of these lines, which costs a link this checker does not resolve;
 * failing to narrow invents findings and hides others, which is the direction that misleads.
 */
const LEAF_OPENER = /^ {0,3}(?:#{1,6}[ \t]|(?:[-*+]|\d{1,9}[.)])[ \t]|>|={2,}[ \t]*$|-{2,}[ \t]*$|\*{3,}[ \t]*$|_{3,}[ \t]*$)/;

/**
 * A line opening a raw HTML block. CommonMark disables Markdown inside one until the next blank
 * line, so a `](` in there is markup, not a link — reporting it invents a finding. A blank line ends
 * it either way, so content deliberately written as Markdown between `<details>` and `</details>` is
 * its own block and still scanned.
 */


/**
 * The block-level tags of CommonMark's HTML block **type 6** — the closed list that may interrupt a
 * paragraph. Type 7, any other tag, may not: `<a id="x">` on the line below a paragraph is inline
 * content, and consuming it as a block split a code span in half and read the `id` inside it as a
 * live anchor. The list is the spec's, not a sample.
 */
const HTML_BLOCK_6 = new RegExp(`^ {0,3}</?(?:${[
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center',
  'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head',
  'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav',
  'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section', 'summary', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
].join('|')})(?:[ \\t>/]|$)`, 'i');

/**
 * The scannable blocks, each with the 1-based line its first character sits on. Bounded by a blank
 * line or by any `LEAF_OPENER`; raw HTML blocks are dropped whole.
 */
/**
 * A GFM delimiter row. A table is confirmed by this line, never by a leading `|`: `| a | b |` on its
 * own is an ordinary paragraph, and cell-splitting it tears code spans that legitimately contain a
 * pipe. Leading pipes are optional in GFM, so `a | b` over `--- | ---` is a table too.
 */
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

/**
 * Raw-HTML openers whose extent this scanner does **not** model, with the sequence that ends each.
 * CommonMark type 1–5 blocks run through blank lines until their terminator, so ending them at a
 * blank line — as type 6 and 7 do — would hand the resolver a definitive target for syntax still
 * inside raw HTML. Everything between opener and terminator is counted, never classified.
 */
const HTML_RAW = [
  [/^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
  [/^ {0,3}<![A-Za-z]/, />/],
];

/**
 * A blockquote prefix does not stop a raw-HTML block from opening, and testing the bare line said it
 * did. `<!--` moved out of this list entirely — a comment is an inline construct found wherever it
 * starts, which is `inlineOpaque`'s job and covers `> <!-- … -->` and mid-line openers alike.
 */
const CONTAINER_PREFIX = /^ {0,3}(?:>[ \t]?)+/;

/**
 * A line's blockquote depth and the line without that prefix.
 *
 * Depth is what bounds a container-carried construct. A quoted fence consumed "until something that
 * looks like a closer" ran straight out of its blockquote and masked the `# Real` heading below it,
 * so a live `#real` link was reported dead. The container ends where the prefix stops, and so does
 * anything it carries.
 */
function unwrap(line) {
  const m = CONTAINER_PREFIX.exec(line);
  if (!m) return { depth: 0, bare: line };
  return { depth: m[0].replace(/[^>]/g, '').length, bare: line.slice(m[0].length) };
}

/**
 * The line with **exactly** `depth` blockquote markers removed, or `null` when it carries fewer —
 * which is how a container ends.
 *
 * Markers beyond `depth` are content, not container. A leaf block already open at that depth consumes
 * them: `> > ``` ` inside a `> ``` ` fence is a line of code, and stripping every marker made it look
 * like the fence's own closer, ended the block early, and exposed the link below as live Markdown.
 * The same over-stripping made `> >` read as blank and closed a `> <div>` block that was still open.
 */
function stripQuotes(line, depth) {
  let rest = line.replace(/^ {0,3}/, '');
  for (let n = 0; n < depth; n += 1) {
    if (rest[0] !== '>') return null;
    rest = rest.slice(1).replace(/^[ \t]?/, '');
  }
  return rest;
}

/**
 * The fence a **container-carried** line opens, or `null`. Quoted, in a list item, or both: all three
 * are constructs whose extent this scanner does not model, so all three are consumed unproven.
 * Recognising only the quoted form left `- ``` ` unrecognised, and the example inside that fence was
 * resolved against the filesystem and reported as an established dead link.
 */
function containerFence(line, depth) {
  const rest = stripQuotes(line, depth);
  if (rest === null) return null;
  const listed = rest.replace(LIST_MARKER, '');
  if (depth === 0 && listed === rest) return null; // no container at all — the plain path owns it
  return fenceOpener(rest) || fenceOpener(listed);
}

/**
 * The HTML block a **list marker** carries, or `null`. `CONTAINER_PREFIX` covers quote markers only,
 * so `- <div>` opened nothing: the indented `[x](…)` beneath it was read as live Markdown and
 * reported as an established dead link — the one outcome this checker must never produce. The
 * marker's extent is not modelled, so the block is consumed *skipped*: its candidates reach
 * `unresolved` rather than a verdict.
 */
function listedHtmlOpener(line, depth) {
  const rest = stripQuotes(line, depth);
  if (rest === null) return null;
  const listed = rest.replace(LIST_MARKER, '');
  if (listed === rest) return null; // no list marker — the quote-aware paths own this line
  return htmlRawOpener(listed) || htmlBlockOpener(listed) ? listed : null;
}

function htmlRawOpener(line) {
  const bare = line.replace(CONTAINER_PREFIX, '');
  return HTML_RAW.find(([open]) => open.test(bare)) || null;
}

/**
 * CommonMark's HTML block **type 7**: a complete open or closing tag, alone on its line. The earlier
 * pattern let a tag name end at end-of-line, so the bare text `<x` opened a block, swallowed the
 * heading beneath it, and reported a live `#real` fragment dead. An incomplete tag is a paragraph.
 */
const HTML_TAG_ALONE = new RegExp(
  '^ {0,3}<(?:'
  + '[a-zA-Z][a-zA-Z0-9-]*'
  + '(?:[ \\t]+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:[ \\t]*=[ \\t]*(?:[^ \\t"\'=<>`]+|\'[^\']*\'|"[^"]*"))?)*'
  + '[ \\t]*/?'
  + '|/[a-zA-Z][a-zA-Z0-9-]*[ \\t]*'
  + ')>[ \\t]*$',
);

/** Whether a line opens a generic (type 6 or 7) HTML block. */
function htmlBlockOpener(line) {
  return HTML_BLOCK_6.test(line) || HTML_TAG_ALONE.test(line);
}

/**
 * The scannable blocks, each with the 1-based line it starts on and the raw offset of that line.
 * Bounded by a blank line, by any `LEAF_OPENER`, and by a code block — a fenced or indented region is
 * no longer blanked out beforehand, so it has to end the block it interrupts. `skipped` marks a block
 * whose content this scanner will not classify at all; its link shapes are counted as unresolved.
 */
function blocksOf(source) {
  source = normalizeEol(source);
  const lines = source.split('\n');
  const starts = lineOffsets(source);
  const code = codeBlockRegions(source);
  const blocks = [];
  let start = -1;
  let startDepth = 0;
  // A block that begins where the quote depth changed with no blank line between is a **lazy
  // continuation**, and which construct owns it — the quote's paragraph, or a new one — is exactly
  // what this scanner does not model. It is consumed unread so its candidates reach `unresolved`:
  // deciding either way invents an answer, and both directions were observed doing it.
  let startLazy = false;
  const close = (endExclusive) => {
    if (start === -1) return;
    const rows = lines.slice(start, endExclusive);
    blocks.push({
      text: rows.join('\n'),
      line: start + 1,
      from: starts[start],
      skipped: startLazy || htmlBlockOpener(unwrap(lines[start]).bare),
      // GFM puts the delimiter **immediately** after the header. Accepting one anywhere below let a
      // paragraph two lines above a `--- | ---` be read as a table, and cell-splitting it tore a
      // legitimate code span in half and reported its contents as a dead link.
      // The delimiter is read through the container. Leaving the `> ` on it meant a quoted table
      // was never confirmed as one, so its cells were never split and backticks in two different
      // cells paired into a span that erased the link between them.
      table: rows.length > 1 && TABLE_DELIMITER.test(stripQuotes(rows[1], startDepth) ?? rows[1]),
    });
    start = -1;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (regionAt(code, starts[i])) { close(i); continue; }
    const raw = htmlRawOpener(line);
    if (raw) {
      close(i);
      // A raw block ends at its terminator **or** at its container, whichever comes first. Searching
      // the whole source consumed `> <pre>` through an unquoted `</pre>` and swallowed every line
      // between them, so the links in the quote left the accounting without being counted.
      const depth = unwrap(line).depth;
      let end = i;
      for (; end < lines.length; end += 1) {
        const rest = stripQuotes(lines[end], depth);
        if (rest === null) { end -= 1; break; }
        if (raw[1].test(rest)) break;
      }
      end = Math.min(end, lines.length - 1);
      blocks.push({
        text: lines.slice(i, end + 1).join('\n'),
        line: i + 1,
        from: starts[i],
        skipped: true,
        table: false,
      });
      i = end;
      continue;
    }
    if (listedHtmlOpener(line, unwrap(line).depth)) {
      close(i);
      const depth = unwrap(line).depth;
      let end = i;
      while (end < lines.length) {
        const rest = stripQuotes(lines[end], depth);
        if (rest === null || rest.trim() === '') break;
        end += 1;
      }
      blocks.push({
        text: lines.slice(i, end).join('\n'), line: i + 1, from: starts[i], skipped: true, table: false,
      });
      i = end - 1;
      continue;
    }
    // A generic (type 6/7) HTML block stays opaque until a **blank line**, not until the next thing
    // that looks like Markdown. Letting a `LEAF_OPENER` close it split `<div>` from the `- [x](…)`
    // beneath it and reported that line as a dead link — a finding invented out of raw HTML.
    // The prefix is stripped before the test for the same reason it is for a fence: `> <div>` opens
    // an HTML block inside the quote, and reading the bare line left the `- [x](…)` under it as live
    // Markdown — a dead link invented out of raw HTML. It ends where the blank line or the container
    // does, whichever comes first.
    const html = unwrap(line);
    if (htmlBlockOpener(html.bare) && (start === -1 || HTML_BLOCK_6.test(html.bare))) {
      close(i);
      let end = i;
      while (end < lines.length) {
        const rest = stripQuotes(lines[end], html.depth);
        if (rest === null || rest.trim() === '') break;
        end += 1;
      }
      blocks.push({
        text: lines.slice(i, end).join('\n'),
        line: i + 1,
        from: starts[i],
        skipped: true,
        table: false,
      });
      i = end - 1;
      continue;
    }
    if (line.trim() === '') { close(i); continue; }
    // A blockquote marker is a **container**, not a leaf opener: closing on every `>` made each
    // quoted line its own block, which is why a quoted table never formed. The leaf test therefore
    // reads the content, and a change of quote depth is what ends the block.
    const here = unwrap(line);
    let lazy = false;
    // Lazy continuation extends only a *paragraph*, and it works by **omitting** markers — so a
    // lazy line is always shallower than its block, and a line that opens a leaf block of its own
    // (heading, list marker, thematic break) is decisively new either way. Declining those hands
    // the reviewer work the grammar already settled.
    if (start !== -1 && here.depth !== startDepth) {
      close(i);
      lazy = here.depth < startDepth && !LEAF_OPENER.test(here.bare);
    }
    if (LEAF_OPENER.test(here.bare)) close(i);
    if (start === -1) { start = i; startDepth = here.depth; startLazy = lazy; }
  }
  close(lines.length);
  return blocks;
}

/**
 * Every unescaped `](` in a string, as offsets — the *shape* of a link, whatever it turns out to be.
 */
function linkOpenerOffsets(text) {
  const at = [];
  for (let i = 0; i < text.length - 1; i += 1) {
    if (text[i] === ']' && text[i + 1] === '(' && !escaped(text, i)) at.push(i);
  }
  return at;
}

/** How many of them there are. */
function linkOpeners(text) {
  return linkOpenerOffsets(text).length;
}

/**
 * Every link target in the document with the line it sits on, and `unresolved` — the number of
 * link-shaped constructs this scanner declined to turn into a target.
 *
 * **Candidates are inventoried on the raw text, before any lossy step**, and each one leaves with
 * exactly one of three outcomes: *classified* into a target, *proven* not to be a link, or
 * *unresolved*. Counting only the parser's own exits was the earlier design and it left a silent
 * gap — a candidate erased by masking never reached a counted exit, so `unresolved: 0` could be
 * reported for a document whose link had disappeared.
 *
 * A candidate is **proven** not to be a link when it lies in a range this scanner settled from the
 * line grammar alone — a fenced or indented code block, an HTML comment — or inside a code span that
 * opens and closes **on one line**. A span crossing a newline is exactly where container structure
 * decides the answer — a table cell, a list item, a blockquote — and this scanner does not model
 * containers well enough for its erasure to be evidence, so such a candidate is unresolved instead.
 *
 * Every lossy step now hands back a **range** rather than editing the text, which is what makes the
 * three outcomes exhaustive. The previous design blanked fences before anything was counted and then
 * reconstructed span boundaries by walking the masked text for spaces; a candidate the pre-pass
 * removed reached no exit at all, and the walk stopped at the first space the original already had.
 * Both were paths out of the accounting, and both are gone: the inventory runs on raw block text and
 * every candidate is looked up in the ranges.
 */
function targetsOf(source) {
  source = normalizeEol(source);
  const found = [];
  let unresolved = 0;
  const blocks = blocksOf(source);
  const opaque = opaqueRanges(source, blocks, codeBlockRegions(source));
  const maskedSource = maskRanges(source, opaque);
  // A code region this scanner could not settle — a fence carried by a blockquote, whose end it does
  // not model — holds lines no block contains, so the block pass below never sees them. Counting
  // them here is what keeps "every candidate reaches an exit" true rather than merely intended.
  for (const region of codeBlockRegions(source)) {
    if (region.proven) continue;
    const text = source.slice(region.from, region.to);
    unresolved += linkOpeners(text);
    unresolved += text.split('\n').filter((l) => REF_LABEL.test(l) || REF_LABEL_LOOSE.test(l)).length;
  }

  for (const block of blocks) {
    const masked = maskedSource.slice(block.from, block.from + block.text.length);
    // A skipped block is one whose Markdown this scanner will not read. It still has ranges, and
    // consulting them is not optional: a column-zero `<!-- … -->` is a *settled* comment, and taking
    // the skipped shortcut before looking counted it as unclassified — a computed range that never
    // reached the decision, which is exactly what this design exists to prevent.
    const matches = block.skipped ? [] : matchesIn(masked);
    const classified = new Set(matches.map((m) => m.opener));
    for (const { target, offset } of matches) {
      // Masking preserves length, so an offset into the masked text indexes the original too.
      const line = block.line + block.text.slice(0, offset).split('\n').length - 1;
      found.push({ target, line });
    }

    /** The one decision. Every candidate in the document goes through it, whatever found it. */
    const verdict = (at) => {
      const region = regionAt(opaque, block.from + at);
      if (region) return region.proven ? 'proven' : 'unresolved';
      return block.skipped ? 'unresolved' : 'parse';
    };

    for (const at of linkOpenerOffsets(block.text)) {
      const outcome = verdict(at);
      if (outcome === 'proven') continue;
      if (outcome === 'unresolved' || !classified.has(at)) unresolved += 1;
    }

    // Reference definitions are inventoried on **raw** text for the same reason inline candidates
    // are. Reading them off the masked lines meant an uncertain span could erase a definition with
    // nothing counted — the target simply vanished, and the report said the document was clean.
    const lines = block.text.split('\n');
    const maskedLines = masked.split('\n');
    let at = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (REF_LABEL.test(lines[i])) {
        const outcome = verdict(at);
        if (outcome === 'parse') {
          const ref = referenceTarget(maskedLines[i]);
          if (ref !== null) found.push({ target: ref, line: block.line + i });
          else unresolved += 1;
        } else if (outcome === 'unresolved') {
          unresolved += 1;
        }
      } else if (REF_LABEL_LOOSE.test(lines[i]) && verdict(at) !== 'proven') {
        unresolved += 1;
      }
      at += lines[i].length + 1;
    }
  }
  return { targets: found, unresolved };
}

/**
 * `decodeURIComponent` throws on a malformed escape, and a link is user text: `[x](bad%ZZ.md)` in
 * any scanned document would abort the whole run and print nothing, which is the one thing an
 * always-exit-0 advisory checker must not do. Undecodable is a finding, not an exception.
 */
function decodeTarget(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Does this resolved path stay inside the repository?
 *
 * `realpath` on the nearest existing ancestor, because a link to a file that does not exist still
 * has to be judged: the answer for `../../../etc/passwd` is "outside", not "missing". A symlink
 * whose target escapes is the same answer for the same reason — the containment question is about
 * where the bytes are, not about how the path is spelled.
 */
function insideRepo(root, resolved) {
  let probe = resolved;
  for (;;) {
    try {
      const real = fs.realpathSync(probe);
      // No substring test for `..`: `path.resolve` has already normalized parent segments, so the
      // only `..` left is two literal dots inside a filename, and `missing..note.md` is a typo —
      // a dead link — not an escape.
      return real === root || real.startsWith(`${root}${path.sep}`);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

/**
 * @param {string} file repo-relative path of the document to check
 * @param {string} root absolute repository root
 * @returns {{failures: Array<{file, line, target, reason}>, unresolved: number}} one failure entry
 *   per target that does not resolve, plus how many link shapes were left unclassified
 */
function scanFile(file, root) {
  const abs = path.resolve(root, file);
  let source;
  try {
    source = fs.readFileSync(abs, 'utf8');
  } catch {
    return { failures: [{ file, line: 0, target: file, reason: 'unreadable' }], unresolved: 0 };
  }

  const failures = [];
  const scan = targetsOf(source);

  for (const { target, line } of scan.targets) {
    if (!target) continue;

    // The fragment is split off **before** every other test, because the file part is what those
    // tests are about. Filtering the whole target first read `missing.md#{SECTION}` as templated and
    // skipped a concrete file the checker was supposed to resolve.
    //
    // A heading fragment is **out of scope**, so it is dropped rather than counted — the same
    // treatment external URLs and templated placeholders get, and for the same reason: a declared
    // scope boundary is not lost coverage. `#frag` alone names no file and leaves entirely.
    const hash = target.indexOf('#');
    const filePart = hash === -1 ? target : target.slice(0, hash);
    if (!filePart) continue;
    if (EXTERNAL.test(filePart) || TEMPLATED.test(filePart)) continue;
    const decodedFile = decodeTarget(filePart);
    if (decodedFile === null) {
      failures.push({ file, line, target, reason: 'malformed-target' });
      continue;
    }

    const resolved = path.resolve(path.dirname(abs), decodedFile);
    if (!insideRepo(root, resolved)) {
      failures.push({ file, line, target, reason: 'outside-repository' });
      continue;
    }
    if (!fs.existsSync(resolved)) failures.push({ file, line, target, reason: 'dead-link' });
  }

  return { failures, unresolved: scan.unresolved };
}

/** The failures alone. The coverage question is `scanFile`'s; this is for callers that have one. */
function checkFile(file, root) {
  return scanFile(file, root).failures;
}

function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag > -1 && argv[rootFlag + 1]
    ? path.resolve(argv[rootFlag + 1])
    : process.cwd();
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--root');

  // One document must not be able to take the report down with it: an unexpected throw is reported
  // against that file and the rest still get checked.
  const results = files.map((f) => {
    try {
      return scanFile(f, realRoot);
    } catch (err) {
      return {
        failures: [{ file: f, line: 0, target: f, reason: 'check-failed', detail: String(err && err.message) }],
        unresolved: 0,
      };
    }
  });
  const failures = results.flatMap((r) => r.failures);
  const unresolved = results.reduce((n, r) => n + r.unresolved, 0);
  // `unresolved` travels with the report on purpose: without it an empty `failures` array is read as
  // "every link resolves", which is a claim this scanner is not in a position to make.
  process.stdout.write(`${JSON.stringify({ checked: files.length, failures, unresolved }, null, 2)}\n`);
  // Advisory: the reviewer decides what a dead link means. Exiting non-zero here would make this a
  // gate, and a gate is exactly what this feature exists to stop adding.
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

// The range producers (`blocksOf`, `opaqueRanges`, `codeBlockRegions`) are deliberately absent:
// their coordinates index the normalized text, so composing them from outside over a raw CRLF
// source misapplies every range. What is exported either maps its positions back onto the caller's
// input (`inlineMatches`) or speaks in line numbers, which normalization cannot shift (`targetsOf`).
module.exports = {
  checkFile, scanFile, targetsOf, inlineTargets, inlineMatches, referenceTarget,
  linkOpeners, insideRepo, main, maskRanges,
};
