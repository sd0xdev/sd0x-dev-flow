'use strict';

// Markdown block structure, shared by the guards that pin normative prose: `test/rules/
// override-contract.test.js` (which sections a rule file really defines) and `test/skills/
// install-rules-customize.test.js` (whether the install contract is live text).
//
// One scanner, one answer. Two parallel implementations — a line-level `liveLines` and a
// character-level `visibleMask` — drifted apart and were defeated separately; every public
// function here now derives from the single `scan()` pass below. Its ordering rule is the one
// that matters: constructs are resolved in DOCUMENT ORDER, so whichever of `<!--` and a fence
// opens first makes the other inert. Resolving fences up front is what let a fenced block inside
// an HTML comment read as visible documentation.

/** Columns of leading whitespace, CommonMark tab stops of 4. Matching `^(?:\t| {4})` instead lets
 *  one space plus a tab reach column 4 — indented-code territory — without being recognized. */
function indentWidth(line) {
  let col = 0;
  for (const ch of line) {
    if (ch === ' ') col += 1;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** Column reached after `prefix`, counting every character rather than stopping at the first
 *  non-space. `indentWidth('10. ')` is 0 — correct for "how indented is this line", wrong for
 *  "where does the list item's content start". */
function columnAfter(prefix) {
  let col = 0;
  for (const ch of prefix) col += ch === '\t' ? 4 - (col % 4) : 1;
  return col;
}

/** The name of an ATX heading at `level`, or null. Up to three leading spaces, a space or tab after
 *  the marker, an optional closing `#` run that is not part of the name. Backticks are NOT stripped:
 *  a standalone `` `## Tier` `` line is inline code, not a section. */
function atxHeadingName(line, level = 2) {
  // Tolerate a terminal CR here as well as in toLines(): a caller that split the document itself
  // must not silently see zero headings in a CRLF file.
  const m = line.replace(/\r$/, '').match(/^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/);
  if (!m || m[1].length !== level) return null;
  const name = m[2].trim();
  return name === '' ? null : name.replace(/\s+/g, ' ');
}

/** Split into lines, keeping any CR. Every trailing-anchored pattern here tolerates one
 *  explicitly (`\r?$`), because stripping it instead broke the length-preserving guarantee
 *  `liveText()` depends on: a CRLF document came back shorter than it went in, so a bounded
 *  `/A[\s\S]{0,N}B/` could fail on the real file and succeed on the mask. */
function toLines(doc) {
  return doc.split('\n');
}

/** True when the character at `i` is escaped — preceded by an ODD run of backslashes. An even run
 *  is escaped backslashes followed by a live delimiter. */
function isEscaped(line, i) {
  let n = 0;
  for (let j = i - 1; j >= 0 && line[j] === '\\'; j -= 1) n += 1;
  return n % 2 === 1;
}

/** A line minus its blockquote prefix. Fences and comments work identically inside a blockquote,
 *  and a `> ```markdown` example that reads as normative prose is the same false pass as an
 *  unquoted one. */
function stripQuote(line) {
  const m = line.match(/^(?: {0,3}>[ \t]?)*/);
  return { depth: (m[0].match(/>/g) || []).length, rest: line.slice(m[0].length) };
}

/** A fence opener's parameters, or null. Rules, each because a probe defeated the simpler version:
 *  a backtick opener's info string may not contain a backtick (CommonMark 5.6.1); an opener may
 *  follow a list marker with one to four spaces of padding — more is indented code. */
function opensFence(line) {
  const { depth, rest } = stripQuote(line);
  const m = rest.match(/^ {0,3}((?:[-*+]|\d{1,9}[.)])[ \t]{1,4})?(`{3,}|~{3,})(.*)\r?$/);
  if (!m || (m[2][0] === '`' && m[3].includes('`'))) return null;
  return {
    char: m[2][0],
    len: m[2].length,
    quoteDepth: depth,
    // Where the marker itself begins — NOT zero-unless-a-list-marker-shares-the-line. A fence
    // opened on a list *continuation* line has no marker to detect, so it was recorded as
    // top-level and an unindented run closed it, leaving the rest of the document reading as
    // normative prose when a renderer puts it inside <pre><code>. Keying on the opener's own
    // column needs no container stack, and errs toward keeping the fence open — over-hiding.
    containerCol: columnAfter(rest.slice(0, rest.indexOf(m[2]))),
  };
}

/** Whether `line` closes `fence`: same character, at least as long, nothing else on the line, and
 *  indented between its container's column and three past it — so a column-zero backtick run
 *  neither closes a list-nested fence nor is mistaken for one. */
function closesFence(line, fence) {
  const { depth, rest } = stripQuote(line);
  // Same container, or it is not a closer. A `> ```' line inside a top-level fence is literal
  // content, not a delimiter — accepting it let a fenced block be "closed" from inside itself,
  // making every heading after it read as normative prose.
  if (depth !== fence.quoteDepth) return false;
  const m = rest.match(/^([ \t]*)(`{3,}|~{3,})[ \t]*\r?$/);
  if (!m || m[2][0] !== fence.char || m[2].length < fence.len) return false;
  // EXACTLY the opener's column. CommonMark's window is 0–3 past the *container's* content
  // column, which needs a container stack to know; a window keyed to the opener instead was
  // wrong at both ends — it rejected valid shallower closers (harmless over-hiding) but also
  // accepted invalid deeper ones, which is the direction that certifies fenced prose as a rule.
  // Requiring equality is the narrowest rule that still accepts every genuine closer, and every
  // case it gets wrong leaves the fence open.
  return indentWidth(m[1]) === fence.containerCol;
}

/** Whether a line starts an HTML block, and how that block ends.
 *
 *  `<script>`, `<pre>`, `<style>` and `<textarea>` run to their closing tag; every other HTML
 *  block ends at a blank line. Both are invisible or non-normative to a reader — `<script
 *  type="text/plain">` renders as nothing at all — so wrapping a rule in one is the same carrier
 *  failure as commenting it out. `<!--` is not handled here; the comment path owns it. */
const HTML_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'iframe', 'main', 'menu',
  'nav', 'ol', 'p', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'ul',
]);
const HTML_RAW_TAGS = new Set(['script', 'pre', 'style', 'textarea']);

function opensHtmlBlock(line) {
  const { rest } = stripQuote(line);
  // A NAMED block tag only. Matching any `<letter` swallowed autolinks (`<https://example.com>`)
  // and paragraphs merely starting with inline HTML, hiding prose a reader plainly sees — a false
  // failure rather than a false pass, but a realistic one.
  const m = rest.match(/^ {0,3}<\/?([a-zA-Z][a-zA-Z0-9-]*)[\s/>]/);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  if (HTML_RAW_TAGS.has(tag)) return { tag };
  return HTML_BLOCK_TAGS.has(tag) ? { tag: null } : null;
}

/** A link reference definition — `[label]: /url`. It produces no rendered output at all, so it
 *  can carry wording that satisfies an assertion while a reader sees nothing. */
function isLinkRefDef(line) {
  // The destination may sit on the NEXT line, and a title on the one after that; requiring a
  // non-space after the colon recognized only the single-line form, leaving the rest live.
  return /^ {0,3}\[[^\]]+\]:/.test(stripQuote(line).rest);
}

/** Whether a line can be a lazy continuation of an open paragraph. Anything that starts a new
 *  block — a heading, a thematic break, a setext underline, a list marker, HTML — interrupts it,
 *  and the next indented line is then code rather than a wrapped line. */
function continuesParagraph(line) {
  const { rest } = stripQuote(line);
  if (rest.trim() === '') return false;
  return !/^ {0,3}(#{1,6}[ \t]|[-*+][ \t]|\d{1,9}[.)][ \t]|<|=+[ \t]*\r?$|((\*|-|_)[ \t]*){3,}\r?$|-+[ \t]*\r?$)/.test(rest);
}

/** Whether a line opens a paragraph. Headings, list markers, block quotes, thematic breaks, HTML
 *  and tables are all non-blank without opening one — and "is a paragraph open" is what decides
 *  whether the next indented line is code or a wrapped continuation. Reading it as "the previous
 *  line was non-blank" left indented code exposed directly after every heading and comment. */
function opensParagraph(line) {
  const { rest } = stripQuote(line);
  if (rest.trim() === '') return false;
  return !/^ {0,3}(#{1,6}[ \t]|[-*+][ \t]|\d{1,9}[.)][ \t]|<|\||=+[ \t]*\r?$|((\*|-|_)[ \t]*){3,}\r?$)/.test(rest);
}

/** Length of the backtick run starting at `line[col]`, or 0. An escaped leading backtick is
 *  literal text and opens nothing. */
function backtickRun(line, col) {
  if (line[col] !== '`' || isEscaped(line, col)) return 0;
  let n = 0;
  while (line[col + n] === '`') n += 1;
  return n;
}

/** Index just past the run that closes a code span opened by `len` backticks on this line, or -1.
 *
 *  Same line only, deliberately. CommonMark spans may cross lines, but block structure is parsed
 *  first — a fence or an HTML comment starting on a later line interrupts the paragraph and the
 *  span never reaches it. Modelling that needs block parsing to run before inline parsing; letting
 *  the inline scanner run ahead instead let a span swallow a fenced block and expose the headings
 *  inside it.
 *
 *  Giving up multiline spans costs an unclosed run being read as literal text, which at worst
 *  opens a comment that is not really there and hides MORE than a reader loses. That direction is
 *  the safe one: over-hiding fails a test loudly, under-hiding certifies prose nobody can see.
 *
 *  A closer is a run of EXACTLY equal length — a longer run does not close a shorter opener, which
 *  is why `` `<!--`` `` has no valid closer and its `<!--` really does open a comment. */
function findSpanClose(line, from, len) {
  let col = from;
  while (col < line.length) {
    if (line[col] === '`') {
      let n = 0;
      while (line[col + n] === '`') n += 1;
      if (n === len) return col + n;
      col += n;
    } else col += 1;
  }
  return -1;
}

/** The single pass every other function here derives from.
 *
 *  Returns a per-character visibility mask (`true` where a reader sees the character), plus
 *  per-line `fenced` and `blockHidden` flags. Indices are UTF-16 code units throughout, matching
 *  how the mask is both built and consumed — mixing those with code-point indices let a string
 *  hidden after an astral character survive masking.
 *
 *  `fencesCount` decides whether fenced content is visible. Pass `true` when a fenced example is
 *  legitimate documentation (a JSON mapping in a tech spec); leave it false when the assertion is
 *  about normative prose, where a fence means "example, not rule". It never applies to a fence
 *  that opened inside a comment — that block is hidden by the comment, not by being fenced. */
function scan(doc, { fencesCount = false } = {}) {
  const lines = toLines(doc);
  const mask = lines.map((l) => new Array(l.length).fill(true));
  const fenced = new Array(lines.length).fill(false);
  const commented = new Array(lines.length).fill(false);
  const blockHidden = new Array(lines.length).fill(false);
  const hideLine = (row) => mask[row].fill(false);

  const front = frontMatterRows(doc);
  let inComment = false;
  let fence = null;
  let indented = false;
  let html = null;
  // Indented code cannot interrupt a paragraph, so entering the state needs to know whether one
  // is open. Without this, every wrapped continuation line would read as code.
  let paraOpen = false;
  let row = 0;
  let col = 0;

  while (row < lines.length) {
    const line = lines[row];

    if (col === 0 && row <= front.to) {
      // Metadata, not prose — hidden whatever `fencesCount` says, for the same reason an HTML
      // block is: that flag opts into fenced code examples, and front matter is not one.
      blockHidden[row] = true;
      hideLine(row);
      paraOpen = false;
      row += 1;
      continue;
    }
    if (col === 0 && inComment) {
      blockHidden[row] = true;
      commented[row] = true;
    }

    // Block state is decided at the start of a line, and only when no comment is open: inside a
    // comment a fence marker is inert text, so the comment keeps consuming until `-->`.
    if (col === 0 && !inComment) {
      if (fence) {
        // A fence cannot outlive its container: an unquoted line ends a blockquoted fence, and
        // the line is then re-examined, because that same line may open a new top-level one.
        if (stripQuote(line).depth < fence.quoteDepth) {
          fence = null;
          continue;
        }
        fenced[row] = true;
        blockHidden[row] = true;
        if (!fencesCount) hideLine(row);
        if (closesFence(line, fence)) fence = null;
        paraOpen = false;
        row += 1;
        continue;
      }
      // An HTML block is hidden whatever `fencesCount` says: that flag opts into fenced *code
      // examples* as evidence, and an HTML block is not one — treating it as opt-in would leave
      // the tech spec, which does pass fencesCount, open to exactly this carrier.
      if (html) {
        blockHidden[row] = true;
        hideLine(row);
        const done = html.tag
          ? new RegExp(`</${html.tag}>`, 'i').test(line)
          : line.trim() === '';
        if (done) html = null;
        paraOpen = false;
        row += 1;
        continue;
      }
      // An indented code block runs until a non-blank line comes back out to column < 4.
      if (indented) {
        if (line.trim() === '' || indentWidth(line) >= 4) {
          blockHidden[row] = true;
          if (!fencesCount) hideLine(row);
          row += 1;
          continue;
        }
        indented = false;
      }
      const opened = opensFence(line);
      if (opened) {
        fence = opened;
        fenced[row] = true;
        blockHidden[row] = true;
        if (!fencesCount) hideLine(row);
        paraOpen = false;
        row += 1;
        continue;
      }
      // Four columns in and not continuing a paragraph: a renderer puts this in <pre><code>, so
      // asserting on it would certify an example as a rule — the same false pass as a fence.
      if (!paraOpen && line.trim() !== '' && indentWidth(line) >= 4) {
        indented = true;
        blockHidden[row] = true;
        if (!fencesCount) hideLine(row);
        row += 1;
        continue;
      }
      const opensHtml = opensParagraph(line) ? null : opensHtmlBlock(line);
      if (opensHtml) {
        blockHidden[row] = true;
        hideLine(row);
        const closedHere = opensHtml.tag
          ? new RegExp(`</${opensHtml.tag}>`, 'i').test(line)
          : line.trim() === '';
        html = closedHere ? null : opensHtml;
        paraOpen = false;
        row += 1;
        continue;
      }
      if (isLinkRefDef(line)) {
        blockHidden[row] = true;
        hideLine(row);
        paraOpen = false;
        row += 1;
        continue;
      }
    }

    if (col >= line.length) {
      // A paragraph continues only through lines that could BE paragraph text. Carrying the
      // state through any non-blank line let a heading or a setext underline preserve it, so the
      // indented code that followed stayed exposed.
      paraOpen = opensParagraph(line) || (paraOpen && continuesParagraph(line));
      row += 1;
      col = 0;
      continue;
    }

    if (inComment) {
      mask[row][col] = false;
      if (line.startsWith('-->', col)) {
        mask[row][col + 1] = false;
        mask[row][col + 2] = false;
        col += 3;
        inComment = false;
      } else col += 1;
      continue;
    }

    // Code-span contents are VISIBLE — `` `<!--` `` renders as text a reader reads — so they stay
    // live; the span is skipped only as a place to look for comment delimiters.
    const run = backtickRun(line, col);
    if (run) {
      const close = findSpanClose(line, col + run, run);
      col = close === -1 ? col + run : close;
      continue;
    }

    if (line.startsWith('<!--', col) && !isEscaped(line, col)) {
      inComment = true;
      continue;
    }
    col += 1;
  }

  return { lines, mask, fenced, commented, blockHidden };
}

/** Per-character visibility for the whole document: `true` where a reader sees the character. */
function visibleMask(doc, opts = {}) {
  return scan(doc, opts).mask;
}

/** Per-line flags: is this line part of a fenced code block (delimiters included)? A fence opened
 *  inside an HTML comment is not one — it is comment text that happens to look like a fence. */
function fencedLines(doc) {
  return scan(doc).fenced;
}

/** Per-line flags: is this line inside an HTML comment block? Distinct from `liveLines`, which
 *  also reports lines hidden as HTML blocks or indented code — the very classifications the
 *  structural gate must not trust, since trusting them is what it exists to stop doing. */
function commentedLines(doc) {
  return scan(doc).commented;
}

/** Per-line flags: `true` where the line is live document text, `false` where the whole line sits
 *  inside a fenced code block or an HTML comment. A line whose comment opens partway through stays
 *  live — its visible prefix is real document text, and `visibleMask` has the detail. */
function liveLines(doc) {
  return scan(doc).blockHidden.map((hidden) => !hidden);
}

/** The document with every hidden character replaced by NUL, preserving length and line numbering.
 *
 *  This exists because "assert the doc says X" is only evidence if X is *visible*. Every raw
 *  `assert.match(doc, /..../)` in a contract test is one HTML comment away from certifying dead
 *  prose — which, for R8 specifically, is the exact defect under test.
 *
 *  NUL rather than a space or an empty string: blanking shortens the document, so a bounded
 *  pattern could match across a gap that was too wide before the text was hidden, and spaces would
 *  let a `\s+` bridge span it. NUL is neither shorter nor whitespace. */
function liveText(doc, opts = {}) {
  const { lines, mask } = scan(doc, opts);
  return lines
    .map((line, row) => {
      let out = '';
      // Indexed by UTF-16 code unit, exactly as the mask is: iterating code points here would
      // shift every index after an astral character and expose the text behind it.
      for (let col = 0; col < line.length; col += 1) {
        out += mask[row][col] ? line.charAt(col) : '\u0000';
      }
      return out;
    })
    .join('\n');
}

/** Every heading at `level` the document actually defines. Parsed from the MASKED document, so a
 *  heading hidden in a fence or a comment — including one only partly hidden — cannot satisfy an
 *  existence assertion after the genuine one was deleted. */
function documentSections(doc, level = 2) {
  const out = [];
  for (const line of toLines(liveText(doc))) {
    const name = atxHeadingName(line, level);
    if (name) out.push(name);
  }
  return out;
}

/** Non-blank lines that open a block at column 4 or deeper — an indented code block. A line
 *  continuing an already-open paragraph is excluded, because indented code cannot interrupt a
 *  paragraph, and rejecting those would fail on ordinary re-wrapping. */
function indentedCodeLines(text) {
  const lines = toLines(text);
  return lines.filter((line, i) => {
    if (line.trim() === '') return false;
    if (indentWidth(line) < 4) return false;
    const prev = lines[i - 1];
    return prev === undefined || prev.trim() === '';
  });
}

/** Rows occupied by leading YAML front matter, delimiters included, or an empty range.
 *
 *  Front matter is metadata a renderer never shows as prose. It must be invisible to BOTH sides:
 *  exempting it from the gate while leaving it visible to `liveText()` classified the same text
 *  as "not prose" and "normative evidence" at once, so a claim deleted from a document's body
 *  still passed by sitting in its front matter. */
function frontMatterRows(doc) {
  const lines = toLines(doc);
  const delim = (l) => /^---[ \t]*$/.test((l || '').replace(/\r$/, ''));
  if (!delim(lines[0])) return { from: 0, to: -1 };
  const end = lines.findIndex((l, i) => i > 0 && delim(l));
  return end === -1 ? { from: 0, to: -1 } : { from: 0, to: end };
}

/** Fence regions as the GATE must see them: closing as EARLY as any renderer might.
 *
 *  The gate cannot reuse `fencedLines()`. `scan()` deliberately keeps a fence open whenever it is
 *  unsure — over-hiding, the direction masking is allowed to err in — and its exact-column closer
 *  rule rejects genuine CommonMark closers indented one to three columns. A gate that skipped
 *  everything `scan()` calls fenced would therefore skip live prose: close a fence with a
 *  one-space `~~~`, and the scanner keeps swallowing while the gate stops looking.
 *
 *  So the two biases are deliberately opposite. `scan()` hides as much as it can justify; this
 *  releases as much as it can justify. A line only escapes judgement when BOTH agree it is inert. */
function gateFencedLines(doc) {
  const lines = toLines(doc);
  const out = new Array(lines.length).fill(false);
  // A fence that is itself inert opens nothing. Tracking only the opener's shape let a `~~~`
  // written inside an HTML comment — or inside YAML front matter — put the gate into a fenced
  // state that then swallowed every carrier after it, which is the failure this pass exists to
  // prevent, arrived at from the other side.
  const commented = commentedLines(doc);
  const front = frontMatterRows(doc);
  let fence = null;
  lines.forEach((line, i) => {
    if (commented[i] || (i >= front.from && i <= front.to)) return;
    const { depth, rest } = stripQuote(line);
    const bare = rest.replace(/\r$/, '');
    if (fence) {
      // A fenced block cannot outlive the blockquote that opened it: CommonMark ends the block
      // when the container does, and a gate that kept it open skipped live prose at column 0.
      if (depth < fence.depth) fence = null;
      else {
        out[i] = true;
        const close = bare.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
        // Depth must MATCH. Closing across container boundaries is not something a renderer does,
        // and accepting it turned a `> ~~~` shown inside a top-level example into a real closer.
        if (close && depth === fence.depth
          && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
        return;
      }
    }
    const open = bare.match(/^ {0,3}((?:[-*+]|\d{1,9}[.)])[ \t]{1,4})?(`{3,}|~{3,})(.*)$/);
    if (open && !(open[2][0] === '`' && open[3].includes('`'))) {
      out[i] = true;
      fence = { char: open[2][0], len: open[2].length, depth };
    }
  });
  return out;
}

/** Blank out code-span content, preserving column positions. Every raw-angle-bracket construct in
 *  the guarded documents is metasyntax inside a span — `` `--ac-trace <request-path>` `` — which a
 *  reader sees as literal text. Judging it as HTML would make the gate unusable; not stripping the
 *  spans first would make the HTML rule below either wrong or toothless. Spans are single-line by
 *  construction (see `findSpanClose`), so this needs no cross-line state. */
function stripCodeSpans(line) {
  let out = line;
  let col = 0;
  while (col < out.length) {
    // `backtickRun` is escape-aware and this loop must be too: reading `\` ` as an opener let a
    // span that does not exist blank a real carrier out of the line before it could be judged.
    const n = backtickRun(out, col);
    if (n === 0) { col += 1; continue; }
    const close = findSpanClose(out, col + n, n);
    if (close === -1) { col += n; continue; }
    out = out.slice(0, col) + ' '.repeat(close - col) + out.slice(close);
    col = close;
  }
  return out;
}

/** A `<` that opens an HTML comment — the first of the subset's two carve-outs, recognized here so
 *  a same-line `<!-- … -->` is not judged as raw HTML. */
const COMMENT_OPEN = /^<!--/;

/** A URI or email autolink: `<https://example.com>`, `<someone@example.com>`. Ordinary prose, and
 *  the only other live `<` a guarded document may carry. */
const AUTOLINK = /^<(?:[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>@]+)>/;

/** Every live `<` that is neither carve-out, as column indices.
 *
 *  Matching named tags was still an enumeration, just a broader one: CommonMark's raw-HTML
 *  productions also include processing instructions (`<?…?>`), declarations (`<!DOCTYPE …>`) and
 *  CDATA (`<![CDATA[…]]>`), none of which render as prose and none of which has a tag name — and a
 *  tag whose `<span` ends a line and whose `hidden>` begins the next has no single-line match at
 *  all. So the rule is inverted one last time: the angle bracket itself is the violation, and the
 *  two things a guarded document may legitimately do with one are named explicitly.
 *
 *  Escapes count: `\<` is a literal `<` a reader sees, not markup. */
function rawAngleBrackets(line) {
  const stripped = stripCodeSpans(line);
  const out = [];
  for (let col = 0; col < stripped.length; col += 1) {
    if (stripped[col] !== '<' || isEscaped(stripped, col)) continue;
    const frag = stripped.slice(col);
    if (COMMENT_OPEN.test(frag) || AUTOLINK.test(frag)) continue;
    out.push(col);
  }
  return out;
}

/** An unescaped `](` — the join between any inline link's label and its destination. */
function hasLinkJoin(line) {
  for (let col = line.indexOf(']('); col !== -1; col = line.indexOf('](', col + 1)) {
    if (!isEscaped(line, col)) return true;
  }
  return false;
}

/** Comment rows, as a lexically constrained subset — not a second visibility parser.
 *
 *  Ten rounds of this loop each found one more construct, and the last two were the same failure
 *  arriving from a new direction: a cross-line comment state machine in the gate has to agree with
 *  `scan()`'s, and every place they can disagree is a false green. `<!-->` advances one of them
 *  four columns and the other zero; a `<!--` in front matter or in a disputed fence region opens a
 *  comment in one and not the other.
 *
 *  So the gate stops parsing comments and starts constraining them. A guarded document may write a
 *  comment only in a shape where the two readings cannot diverge: the opener is the first content
 *  on its line, the closer is the last content on its line, delimiters are well formed, and nothing
 *  nests. Every other shape is reported, which is the loud direction. This is the same trade as
 *  round 18 — a smaller input beats a bigger parser — applied to the construct that kept producing
 *  the disagreements.
 *
 *  Returns `{ rows, violations }`: rows a caller must skip, and reasons to report. */
function gateCommentRows(doc, fenced, front) {
  const lines = toLines(doc);
  const rows = new Array(lines.length).fill(false);
  const violations = [];
  const at = (i, why) => violations.push(`${i + 1}: ${why}`);
  let open = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (fenced[i] || (i >= front.from && i <= front.to)) continue;
    // Detection runs on a code-span-stripped copy: `` `<!--` `` shown as metasyntax is documented
    // syntax, not a comment. Column positions are preserved so the checks below stay meaningful.
    const { depth, rest } = stripQuote(lines[i]);
    const raw = rest.replace(/\r$/, '');
    // Code spans are stripped only while looking for an OPENER. Inside a comment they do not
    // exist — a renderer's comment ends at the first `-->` whatever backticks surround it — so
    // stripping them there invented comment state the scanner did not share, and the gate skipped
    // rows it should have judged. Detection outside a comment still ignores metasyntax.
    const probe = open === -1 ? stripCodeSpans(raw) : raw;
    // Container identity, checked per row rather than assumed. `stripQuote()` removes each row's
    // prefix independently, so `> <!--` followed by an unquoted line read as one comment here
    // while CommonMark ended the blockquote — and its HTML block with it — at the unquoted line,
    // rendering the rest as ordinary prose. Every shipped comment is top-level, so the subset says
    // so rather than modelling lazy continuation.
    if (depth !== 0 && (probe.includes('<!--') || probe.includes('-->') || open !== -1)) {
      at(i, 'comment inside a blockquote — write comments at the top level');
    }

    if (open !== -1) {
      rows[i] = true;
      const close = probe.indexOf('-->');
      if (close === -1) {
        if (probe.includes('<!--')) at(i, 'nested comment opener');
        continue;
      }
      if (probe.slice(close + 3).trim() !== '') {
        at(i, 'comment closes mid-line — `-->` must end its line, or the live text after it is never judged');
      }
      if (probe.slice(0, close).includes('<!--')) at(i, 'nested comment opener');
      open = -1;
      continue;
    }

    const start = probe.indexOf('<!--');
    if (start === -1) {
      if (probe.includes('-->')) at(i, 'comment close with no opener');
      continue;
    }
    // Column zero literally, not merely "no non-whitespace before it". An indented `<!--` opens an
    // HTML block inside a list item or an indented code block, where which rows belong to the
    // comment depends on container rules neither reader here models. Every shipped comment is at
    // column zero, so the subset requires it.
    if (start !== 0 || depth !== 0) {
      at(i, 'comment opens mid-line or inside a container — `<!--` must start its line at column zero');
    }
    rows[i] = true;
    // A closer may not overlap its own opener: `<!-->` shares two dashes, and which reading wins
    // decides whether everything after it is comment or prose.
    // An overlapping closer is malformed WHATEVER follows it. Looking for a later closer first let
    // `<!--> … -->` be read as one comment row here while the scanner closed at the overlap and
    // left the rest of the line live — the two readings disagreeing again, in the skip direction.
    const first = raw.indexOf('-->', start);
    if (first !== -1 && first < start + 4) {
      at(i, 'malformed comment delimiter — `<!-->` is not a comment');
      continue;
    }
    const close = first;
    if (close === -1) { open = i; continue; }
    if (raw.slice(close + 3).trim() !== '') {
      at(i, 'comment closes mid-line — `-->` must end its line, or the live text after it is never judged');
    }
    if (raw.slice(start + 4, close).includes('<!--')) at(i, 'nested comment opener');
  }

  if (open !== -1) at(open, 'comment is never closed — everything after it would be skipped');
  return { rows, violations };
}

/** Structures a guarded document may NOT contain, as `line: reason` strings.
 *
 *  Eighteen review rounds established that the scanner cannot be finished: every recognizer added
 *  for one construct created ordering and state interactions with the others that its own fixture
 *  did not reach. The remedy is not a better scanner but a smaller input. A document that pins
 *  normative prose must stay inside the structure the scanner models, and anything outside it is
 *  reported HERE — loudly, naming the line — rather than silently mis-masked.
 *
 *  The judgements are independent line predicates, never `scan()` classifications: a validator
 *  that asked the scanner whether a line is an HTML block would inherit the blind spot it exists
 *  to cover. `scan()` is consulted only to skip commented-out text, and even the fenced-region
 *  skip is computed here with the opposite bias (see `gateFencedLines`).
 *
 *  Container prefixes are stripped before every predicate. Judging raw lines let a blockquote
 *  carry a setext heading and indented code straight past the gate. */
function structuralViolations(doc) {
  const lines = toLines(doc);
  // A line escapes judgement only when BOTH passes call it inert — the invariant this file's
  // header states, now actually enforced. Using the gate's pass alone let its early-close bias
  // create fence RE-ENTRY: a closer accepted too soon leaves the real fence's literal `~~~`
  // content to open a second gate fence that the real closer never closes, and everything after it
  // is skipped. Intersecting means any disagreement produces judgement, so the worst case is a
  // loud false rejection rather than a silent pass.
  const gateFenced = gateFencedLines(doc);
  const scanFenced = fencedLines(doc);
  const fenced = gateFenced.map((v, i) => v && scanFenced[i]);
  const out = [];
  const at = (i, why) => out.push(`${i + 1}: ${why}`);
  const content = (l) => stripQuote(l || '').rest.replace(/\r$/, '');
  const blank = (l) => content(l).trim() === '';

  const front = frontMatterRows(doc);
  const comments = gateCommentRows(doc, fenced, front);
  out.push(...comments.violations);

  for (let i = front.to + 1; i < lines.length; i += 1) {
    // A line the two fence passes classify differently is reported rather than resolved. Deciding
    // it either way is a guess, and a guess in the skip direction is the false green this gate
    // exists to prevent — so disagreement is itself outside the subset.
    if (gateFenced[i] !== scanFenced[i]) {
      at(i, 'fence classification is ambiguous — close the fence at the column it opened');
      continue;
    }
    if (comments.rows[i]) continue;
    const bare = content(lines[i]);
    if (bare.trim() === '') continue;
    const prev = lines[i - 1];

    // A fence OPENER is judged even though it is itself "fenced": its own indentation decides
    // where the block ends, and an indented one is where the container rules bite.
    if (fenced[i] && !fenced[i - 1] && /^ {1,3}(`{3,}|~{3,})/.test(bare)) {
      at(i, 'indented fence opener — open fences at column 0');
    }
    // Everything below judges live prose; a fenced example may legitimately SHOW any of it.
    if (fenced[i]) continue;

    // Anywhere on the line, not just column 0: `Carrier: <script …>rule text</script>` walked past
    // a rule anchored to the line start, and so would `Carrier: <template>…</template>`.
    // An inline link or image hides its destination, its title, and (for an image) everything but
    // the alt text from a rendered reader, while `liveText()` hands all of it to a caller. That is
    // a carrier with no `<` in it, so the angle-bracket rule above cannot see it. Masking
    // destinations instead would restart the parser-expansion cycle §18 ended; a guarded document
    // writes the path as visible text or an autolink.
    // `](` and nothing else: parsing the label was another enumeration, and it missed a nested
    // `[visible [nested]](dest)` and a label wrapped across two lines. The two characters that
    // join any label to any destination cannot be avoided by an inline link, whatever its label.
    if (hasLinkJoin(stripCodeSpans(bare))) {
      at(i, 'inline link or image — its destination and title are not visible prose; write the path as text or an autolink');
    }
    if (rawAngleBrackets(bare).length > 0) {
      at(i, 'raw HTML — only an `<!-- … -->` comment, an autolink, or a fenced example may carry `<`');
    }
    if (/^ {0,3}=+[ \t]*$/.test(bare) && !blank(prev)) {
      at(i, 'setext H1 underline — use an ATX heading');
    }
    if (/^ {0,3}-+[ \t]*$/.test(bare) && !blank(prev) && !/^ {0,3}\|/.test(content(prev))) {
      at(i, 'setext H2 underline — use an ATX heading');
    }
    if (/^ {0,3}\[[^\]]+\]:/.test(bare)) {
      at(i, 'link reference definition — it renders as nothing');
    }
    if (indentWidth(bare) >= 4 && blank(prev)) {
      at(i, 'indented code block — a renderer emits <pre><code>; fence it or outdent it');
    }
  }
  return out;
}

/** Body of the one live heading `name` at `level`, fence-aware, terminated by the next heading of
 *  that level or shallower — a `## Tier` shown inside a fenced example must not end a `### 3.3`
 *  section.
 *
 *  Uniqueness is enforced, not assumed: `findIndex()` extracts the FIRST section of that name, so a
 *  second one appended with the opposite instruction left an equality pin comparing against the
 *  untouched original. A pin has to name one section. Throws rather than asserting so the helper
 *  stays free of a test-framework dependency; callers match the message. */
function sectionAt(text, level, name) {
  const lines = toLines(text);
  const fenced = fencedLines(text);
  const heading = (i, d) => (fenced[i] ? null : atxHeadingName(lines[i], d));
  const hits = lines.map((l, i) => (heading(i, level) === name ? i : -1)).filter((i) => i !== -1);
  if (hits.length !== 1) {
    throw new Error(`section "${name}": expected exactly one live heading, found ${hits.length}`);
  }
  const body = [];
  for (let i = hits[0] + 1; i < lines.length; i += 1) {
    let stop = false;
    for (let d = 1; d <= level; d += 1) if (heading(i, d)) stop = true;
    if (stop) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

// Splits on DELIMITER pipes only, and the test for that is backslash PARITY, not "is the previous
// character a backslash". The distinction is the whole helper: `\|` is a literal pipe inside a
// cell, `\\|` is a rendered backslash followed by a real delimiter, `\\\|` is a backslash plus a
// literal pipe, and so on by odd/even. A lookbehind answers the wrong question and gets every even
// case backwards — measured: `| A | B \\| 777 … | 99 … |` merged two cells, so a guard reading the
// third cell read the excess fourth one and passed on a row publishing 777.
//
// Both error directions are silent in their own way. Inventing a boundary lets a guard read the
// correct half of a wrong cell; missing one shifts every later index, so the row a guard looks for
// is simply not found. A row must also END on a delimiter — anything left after the final pipe
// means that pipe was escaped, and the line is not a table row.
function tableCells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const cells = [];
  let cur = '';
  let backslashes = 0;
  let sawDelimiter = false;
  for (let i = 1; i < t.length; i += 1) {
    const ch = t[i];
    if (ch === '|' && backslashes % 2 === 0) {
      cells.push(cur);
      cur = '';
      backslashes = 0;
      sawDelimiter = true;
      continue;
    }
    cur += ch;
    backslashes = ch === '\\' ? backslashes + 1 : 0;
  }
  // A lone `|` is ordinary Markdown text, not an empty row: without this it parses to `[]` and the
  // arity predicates below reject it for the wrong stated reason.
  if (cur !== '' || !sawDelimiter) return null;
  // Splitting only — the cell is returned as SOURCE. Resolving `\\` and `\|` here as well left two
  // layers each rendering escapes, and the second could not see what the first had consumed:
  // `\\\`` (a rendered backslash then an ESCAPED backtick, so no code span) arrived at
  // `renderInline` as `\\``, which reads as a rendered backslash then a LIVE delimiter — and the
  // emphasis it then shielded was a contradicting claim the reader could see. `renderInline` is
  // the single renderer; identity cells are compared as published.
  return cells.map((c) => c.trim());
}

module.exports = {
  sectionAt,
  tableCells,
  structuralViolations,
  commentedLines,
  indentWidth,
  columnAfter,
  toLines,
  atxHeadingName,
  fencedLines,
  visibleMask,
  liveLines,
  liveText,
  documentSections,
  indentedCodeLines,
};
