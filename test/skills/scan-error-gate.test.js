const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const {
  readFileSync, mkdtempSync, writeFileSync, rmSync, readdirSync, copyFileSync, symlinkSync,
  existsSync, mkdirSync, statSync,
} = require('node:fs');
const { join, posix } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

// Every skill that reads the four source sets has to be told that four empty arrays are an answer
// only when `scan_error` is exactly `false`. The producer sets the flag correctly (pinned in
// `test/scripts/feature-resolver.test.js`); this file pins that the consumers act on it, which is
// the half that turns a correct producer into a correct system. Without it, an unreadable
// `requests/` subtree reaches a skill as `key: "auth"` plus four empty arrays and reads as a
// complete corpus with nothing in it.
// Derived, not hand-kept — the test below recomputes it from the reference graph and fails on any
// drift. It is written out so a reader sees the floor without running the derivation, and so that
// adding a skill to the graph without its gate is a diff on this list rather than a silent pass.
const CONSUMERS = [
  'skills/adr/SKILL.md',
  'skills/architecture/SKILL.md',
  'skills/ask/SKILL.md',
  'skills/create-request/SKILL.md',
  'skills/feasibility-study/SKILL.md',
  'skills/post-dev-recap/SKILL.md',
  'skills/recap-ask/SKILL.md',
  'skills/recap-doc/SKILL.md',
  'skills/req-analyze/SKILL.md',
  'skills/runbook/SKILL.md',
  'skills/tech-brief/SKILL.md',
  'skills/update-docs/SKILL.md',
];

/** The four set names. A skill that reads any of them is a consumer of the sets. */
const SOURCE_SET_NAMES = ['current_authority', 'design_records', 'work_records', 'history_records'];

const raw = (rel) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

/**
 * The instruction surface only — what a reader of the skill is actually told to do. HTML comments
 * are invisible to the dispatcher, and a fenced block is an example rather than a step, so text
 * found only there is inert. Asserting against the raw file let an inert
 * `<!-- scan_error ... Need Human -->` satisfy every check in this file.
 */
/**
 * The instruction surface: the document minus everything that renders as code.
 *
 * **This is deliberately not a Markdown classifier, and the third attempt at making it one is why.**
 * The first version stripped unindented ``` fences; `~~~` and three-space indentation walked past
 * it. The second added four-space indented blocks; container nesting walked past it. The third
 * tracked blockquote depth, list content columns and open paragraphs; list-marker padding, tabs
 * after a marker, thematic breaks read as list markers, setext headings, ordered markers that
 * cannot interrupt a paragraph, HTML blocks and fences crossing a container boundary all walked
 * past *that*. CommonMark block parsing is a container stack, and every round of "add the construct
 * that leaked" bought one construct and a new way to misjudge prose.
 *
 * So the contract changed instead of the parser growing again: **a gate must be stated at the top
 * level of its container** — at most three columns in, after any blockquote markers and at most one
 * list marker. Everything below that is treated as code, whether it is code or a deeply indented
 * paragraph. That is over-strict on purpose, and over-strict in the loud direction: a gate written
 * four columns deep makes this file report the skill as not stating it, and the fix is to write it
 * where a reader meets it. Under-strict is the direction that ships a gate binding nobody.
 *
 * What that buys is that the rules below are each **complete**, not a patch: tab expansion,
 * blockquote markers, one list marker with CommonMark's own padding rule, fenced blocks including
 * the info-string and container-lifetime rules, and type-1 HTML blocks. Nothing here models
 * paragraph state, list nesting or heading types, because nothing here needs to — indentation is
 * never interpreted as anything but "deeper than the top level".
 *
 * Cost, measured rather than assumed: across the whole corpus exactly two gate lines carry
 * indentation — one inside a mermaid fence, which is code, and one `- [ ]` checklist item, whose
 * marker strips back to column zero. The strictness costs this repository nothing today.
 */
const instructions = (relOrText) => stripFences(
  (relOrText.includes('\n') ? relOrText : raw(relOrText)).replace(/<!--[\s\S]*?-->/g, ''),
);

/**
 * The blocks of a skill that state the whole gate: the condition on the block surface, and the
 * reading and the consequence surviving into prose.
 *
 * The split between the two surfaces is deliberate and asymmetric. `scan_error !== false` is code
 * and every consumer writes it as code, so requiring it in prose would fail all twelve. The reading
 * and the consequence are what a human acts on, so a gate whose *only* statement of them is inside
 * a span or a `<code>` element renders as an example and binds nobody.
 */
function gateBlocks(relOrText) {
  return markdownBlocks(instructions(relOrText)).filter((block) => {
    if (!statesStrictCondition(block)) return false;
    const outsideCode = prose(block);
    return /unknown, not empty/.test(outsideCode) && /Need Human/.test(outsideCode);
  });
}

/**
 * The operative condition, required **in the accepted block** rather than anywhere in the file.
 *
 * A bare `/scan_error/` here let the block state the fail-open form — "if `scan_error === true`, the
 * sets are unknown, not empty — Need Human" — while a schema example elsewhere in the same file
 * carried the strict spelling and satisfied the separate file-wide check. That is the precise
 * failure this whole change exists to prevent: a payload from a shell fallback or an older producer
 * has no such field, so `=== true` is false and the gate opens on an unreadable corpus. The
 * condition a reader acts on is the one in the block beside the reading and the consequence.
 */
const STRICT_CONDITION = /scan_error[ \t]*!==[ \t]*false/;

/**
 * The spellings that keep the strict token sequence and lose the strict meaning. `scan_error !==
 * false && key === null` is false exactly when the resolver reports an unreadable corpus *and* still
 * resolved a key — which it can — and `!(scan_error !== false)` is the fail-open form written
 * backwards. Both matched a bare search for the token sequence.
 */
const COMPOSED_CONDITION = /&&|\|\||!\s*\(/;

/**
 * Does this block state the strict condition *as its condition*?
 *
 * Two things a plain regex over the raw block gets wrong in opposite directions. A code span may
 * cross a soft line break — CommonMark renders `` `scan_error\n!== false` `` as the exact condition —
 * so the block is flattened first; a fixed character window rejected that and any explanatory
 * comment inside the span, which is refusing a correct document. And the token sequence says nothing
 * about the boolean it sits in, so the composition is judged on the scope a reader reads it in: the
 * code span carrying it, or the sentence if it is written in prose.
 */
function statesStrictCondition(block) {
  const flat = block.replace(/\n[ \t]*/g, ' ');
  const found = STRICT_CONDITION.exec(flat);
  if (!found) return false;
  const span = codeSpanRanges(flat).find((r) => found.index >= r.start && found.index < r.end);
  const scope = span ? flat.slice(span.start, span.end) : sentenceAround(flat, found.index);
  return !COMPOSED_CONDITION.test(scope);
}

function sentenceAround(text, index) {
  const opens = Math.max(0, text.lastIndexOf('.', index) + 1);
  const closes = text.indexOf('.', index);
  return text.slice(opens, closes === -1 ? text.length : closes);
}

/** The reading and the consequence, spelled as the corpus spells them — shared by every fixture. */
const GATE_TEXT = 'the sets are **unknown, not empty** — take the ⚠️ Need Human exit';

/**
 * A blank line is not the only thing that ends a Markdown block, and treating it as one was a
 * splitter's syntax standing in for the claimed behaviour. A setext underline, an ATX heading and a
 * thematic break each begin or end a block with no blank line in sight, so four abutting blocks —
 * a condition, a rule, an unrelated heading and its unrelated consequence — read as one chunk and
 * satisfied a co-location rule that no reader would have granted them.
 *
 * Deliberately *not* split on: list markers and table rows. `4b. **\`scan_error\` gate**:` followed
 * by a table is how a real consumer states the gate, and splitting there would refuse the corpus.
 */
const ATX_HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
/** Three or more of one character, spaces allowed between them: `* * *` is a break, not a list. */
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** A link reference definition renders as nothing at all, so it can carry text into a paragraph. */
const LINK_REF_DEF = /^ {0,3}\[[^\]\n]+\]:/;

/**
 * Tested against the line's innermost content, which is enough: a break spelled out of list-marker
 * characters (`* * *`, `- - -`) is consumed as markers and leaves nothing behind, and
 * `markdownBlocks` already flushes on an empty content. A break spelled out of anything else
 * (`_ _ _`, `***`) survives the stripping and is matched here. An earlier version also tested the
 * line with only its quote prefix removed; no input reached that branch, which is why it is gone.
 */
function isBlockBoundary(line) {
  const content = splitContainers(expandTabs(line)).content;
  return ATX_HEADING.test(content) || SETEXT_UNDERLINE.test(content)
    || THEMATIC_BREAK.test(content) || LINK_REF_DEF.test(content);
}

function markdownBlocks(text) {
  const blocks = [];
  let current = [];
  const flush = () => { if (current.length) blocks.push(current.join('\n')); current = []; };
  for (const line of text.split('\n')) {
    // A blank line inside a blockquote is a bare `>`, which `trim()` alone reads as content — so the
    // two halves of a quoted gate were one block, and the blank line between them counted for
    // nothing.
    if (splitContainers(expandTabs(line)).content.trim() === '') { flush(); continue; }
    if (isBlockBoundary(line)) { flush(); blocks.push(line); continue; }
    current.push(line);
  }
  flush();
  return blocks;
}

/** Leading blockquote markers, consumed one nesting level at a time. */
const QUOTE_PREFIX = /^ {0,3}> ?/;
/** A list marker and the run of spaces after it; the padding rule is applied separately. */
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])( *)/;
/** A fence opener or closer, once the container prefix is gone. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** CommonMark's type-1 HTML block: raw markup whose content is not Markdown at all. */
const HTML_BLOCK_OPEN = /^ {0,3}<(?:pre|script|style|textarea)(?:[\s>/]|$)/i;
const HTML_BLOCK_CLOSE = /<\/(?:pre|script|style|textarea)>/i;

/** Tabs advance to the next four-column stop; CommonMark counts columns, not characters. */
function expandTabs(line) {
  let out = '';
  for (const ch of line) {
    if (ch === '\t') out += ' '.repeat(4 - (out.length % 4));
    else out += ch;
  }
  return out;
}

/**
 * The container prefix, as a **normalized string** rather than a pair of coordinates.
 *
 * Coordinates answer "where is this line"; they cannot answer "which container owns it". Quote depth
 * plus content column read `- > ~~~` (a fence in a quote in a list item) and a later top-level
 * `> ~~~` as the same place — depth 1, column 0 — so leaving the outer list, which ends the item's
 * unclosed fence, looked like staying inside it and the new fence's opener was consumed as the old
 * one's closer. Every earlier repair of this function added another coordinate rule for another
 * construct; the string carries the whole path, so the comparison stops being construct-by-construct.
 *
 * Quote markers keep their column and their `>`; list markers become the spaces they occupy, because
 * an item's continuation line is indented to exactly where its marker ended. `listCols` records the
 * columns markers were consumed at — that is what tells a sibling item from a continuation, and it
 * is the one thing the string cannot say, since both spell the same spaces.
 */
function splitContainers(line) {
  let rest = line;
  let prefix = '';
  const listCols = [];
  let depth = 0;
  for (;;) {
    const quote = QUOTE_PREFIX.exec(rest);
    if (quote) {
      prefix += quote[0].replace(/[^>]/g, ' ');
      rest = rest.slice(quote[0].length);
      depth += 1;
      continue;
    }
    const marker = listMarkerLength(rest);
    if (marker) {
      listCols.push(prefix.length + (rest.length - rest.trimStart().length));
      prefix += ' '.repeat(marker);
      rest = rest.slice(marker);
      continue;
    }
    return { prefix, listCols, depth, content: rest };
  }
}

/**
 * How many characters one list marker and its padding occupy, per CommonMark: the content column is
 * the marker plus one to four following spaces — but five or more spaces means the item's content is
 * *one* space in and the rest is an indented code block inside the item. `-     gate` is code,
 * `-  gate` is not, and the difference is exactly this rule. `0` means the line opens no item.
 */
function listMarkerLength(body) {
  const m = LIST_MARKER.exec(body);
  if (!m) return 0;
  const markerEnd = m[0].length - m[1].length;
  if (m[1].length === 0 && body.length > markerEnd) return 0;  // `-foo` is not a list at all
  return markerEnd + (m[1].length >= 5 ? 1 : m[1].length);
}

/** The container a block opened in, recorded so later lines can be asked whether they are still in it. */
function containerOf(split) {
  return { prefix: split.prefix, listCols: split.listCols, depth: split.depth };
}

/**
 * Has the container this block opened in ended?
 *
 * Two questions, and they are different. **Is this line still under the same containers** — answered
 * by comparing prefixes column by column, where a `>` must still be a `>` and a column the block's
 * prefix occupied must still be occupied by something. **Is it a new item of the same list** — a
 * fresh marker at a column the block's prefix already has a marker at, which is a sibling and ends
 * the item the block lived in. A continuation line carries no marker and so passes both.
 */
function leftContainer(block, split, content) {
  const indent = content.length - content.trimStart().length;
  if (split.prefix.length + indent < block.prefix.length) return true;
  for (let i = 0; i < block.prefix.length; i += 1) {
    if ((block.prefix[i] === '>') !== (split.prefix[i] === '>')) return true;
  }
  return split.listCols.some((col) => block.listCols.includes(col));
}

function stripFences(text) {
  const out = [];
  let block = null;  // { kind: 'fence' | 'html', marker?, prefix, listCols, depth }

  for (const raw of text.split('\n')) {
    const line = expandTabs(raw);
    const split = splitContainers(line);
    const { depth, content } = split;
    const blank = content.trim() === '';

    // A blank line at no quote depth ends any block that opened inside a blockquote: the quote is
    // what the blank line interrupts, and the block died with it, unclosed.
    if (block && blank && depth === 0 && block.depth > 0) block = null;
    if (block && !blank && leftContainer(block, split, content)) block = null;

    if (block) {
      if (blank) continue;
      if (depth !== block.depth) continue;  // only the fence's own level can close it
      if (block.kind === 'html') {
        if (HTML_BLOCK_CLOSE.test(content)) block = null;
        continue;
      }
      const close = FENCE.exec(content);
      if (close && close[1][0] === block.marker[0]
        && close[1].length >= block.marker.length && close[2].trim() === '') {
        block = null;
      }
      continue;
    }

    if (blank) { out.push(raw); continue; }

    // The list marker is part of the container prefix, so it comes off *before* anything asks what
    // block this is — `stripListMarker` above. A fence opened on the marker line (`- ` then ```) is
    // a fenced block inside the item; looking for the fence first sees a list item that merely
    // contains backticks.
    const open = FENCE.exec(content);
    // A backtick fence's info string may not contain a backtick — otherwise ``` inside a sentence
    // would open a code block and swallow the prose after it.
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      block = { kind: 'fence', marker: open[1], ...containerOf(split) };
      continue;
    }

    if (HTML_BLOCK_OPEN.test(content)) {
      if (!HTML_BLOCK_CLOSE.test(content)) block = { kind: 'html', ...containerOf(split) };
      continue;
    }

    if (content.length - content.trimStart().length >= 4) continue;  // deeper than the top level
    out.push(raw);
  }

  return out.join('\n');
}

/**
 * The instruction surface with **inline** code removed as well: code spans and `<code>` elements.
 *
 * `stripFences` is block-level, so a document whose entire gate sits inside one backtick span or one
 * `<code>` element passes every check while rendering as an example and binding nobody — the same
 * escape as a fenced block, one nesting level down. This is deliberately *not* what the phrase
 * checks read, because a real gate states its condition in a span on purpose: `\`scan_error !== false\``
 * is the correct way to write the condition. What must not be inside a span is the *whole* gate, so
 * the consumer check requires the reading and the consequence — the two parts a human acts on — to
 * survive here, while the condition may live in code.
 */
function prose(text) {
  return stripCodeSpans(stripFences(text).replace(/<code[\s>][\s\S]*?<\/code\s*>/gi, ' '));
}

/**
 * Code spans, matched the way CommonMark matches them: a run of backticks is closed by a **later run
 * of exactly the same length**, and runs are whole tokens.
 *
 * A regex cannot express that, and the version that tried erred in both directions at once. Given
 * `` `a `` `b` `` — one backtick, then two, then one — it used the *second character of the middle
 * run* as a closer and exposed the text after it, so a gate written entirely inside one span leaked
 * out as prose. And given a span with no equal-length closer, which CommonMark renders as visible
 * text with literal backticks, it invented a closer out of a run suffix and deleted real prose.
 * Scanning runs removes both, because a run is never split.
 */
function stripCodeSpans(text) {
  const out = [];
  let cursor = 0;
  for (const span of codeSpanRanges(text)) {
    out.push(text.slice(cursor, span.outerStart), ' ');
    cursor = span.outerEnd;
  }
  out.push(text.slice(cursor));
  return out.join('');
}

/** Every code span in the text: `start`/`end` bound its content, `outerStart`/`outerEnd` its backticks. */
function codeSpanRanges(text) {
  const runs = [];
  const re = /`+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) runs.push({ start: m.index, len: m[0].length });

  const spans = [];
  let cursor = 0;
  for (let i = 0; i < runs.length; i += 1) {
    const open = runs[i];
    if (open.start < cursor) continue;
    let close = i + 1;
    while (close < runs.length && runs[close].len !== open.len) close += 1;
    if (close >= runs.length) continue;  // no equal-length closer: literal backticks, not a span
    spans.push({
      start: open.start + open.len,
      end: runs[close].start,
      outerStart: open.start,
      outerEnd: runs[close].start + runs[close].len,
    });
    cursor = runs[close].start + runs[close].len;
    i = close;
  }
  return spans;
}

/**
 * What the file *mentions*, fences included — the surface for **discovering** that a skill touches
 * something, as against `instructions`, which is the surface for asserting what it was told to do.
 * The two differ on fenced blocks and the difference matters in opposite directions: a gate stated
 * only inside a fence is an example and does not bind, while a `node …` command inside a fence is
 * exactly how this repo writes an executable step — the command scanner further down reads fences
 * for that reason. Discovering consumers from `instructions` would therefore miss a skill whose
 * only contact with the sets is a fenced command, and report a clean list because it never looked.
 * HTML comments are stripped from both: they reach no reader.
 */
const discoverySurface = (text) => text.replace(/<!--[\s\S]*?-->/g, '');
const mentions = (rel) => discoverySurface(raw(rel));

/** Does this text read any of the four sets? The discovery predicate, over supplied text. */
const namesASourceSet = (text) => SOURCE_SET_NAMES.some((n) => text.includes(n));

// A hand-kept list is a list of the skills someone remembered. Membership is a property of the
// files — a skill that names any of the four sets is reading them — so it is derived here and
// compared, and adding a sixth consumer without its gate fails on the next run rather than at the
// next review.
// The relative branch of the edge rule, pinned on text rather than on the repository: both relative
// links this repo contains today point back at their own skill, so a self-cycle is all the live
// corpus exercises and the branch could be deleted with every other test still green. Both
// directions ship together — a relative path to another skill *is* an edge, and prose naming the
// same skill without a path is not — because a guard with only the positive case goes green on the
// day it lands and false-positives later.
// No skill in this repository today reads a source set *only* from inside a fence, so the corpus
// cannot tell fence-inclusive discovery from fence-stripping discovery — swapping one for the other
// leaves every other test green. The distinguishing inputs are supplied here instead. Both
// directions, as always: a fenced command counts, a commented-out one does not.
test('consumer discovery reads fenced commands and ignores HTML comments', () => {
  const fenced = '## Phase 1\n\n```bash\nnode scripts/resolve-feature.js | jq .design_records\n```\n';
  assert.ok(namesASourceSet(discoverySurface(fenced)),
    'a set read only inside a fence is still read — that is how this repo writes an executable step');
  assert.ok(!namesASourceSet(discoverySurface('<!-- once read design_records here -->')),
    'a set named only inside an HTML comment reaches no reader and is not a consumer');
});

// The four-space indented block, pinned on supplied text. CommonMark makes it a code block, and a
// scanner that reads it as prose lets a two-line `export RESOLVER=…` / `bash "$RESOLVER.sh"` pair
// sit in a skill unexamined — paste it into one shell and it invokes the shim. The negative control
// is an ordinary unindented sentence; the wrapped list item is a third case, pinned below as the
// deliberate over-inclusion it is rather than as a control.
test('a four-space indented block is a code context; an unindented sentence is prose', () => {
  const prose = segmentsIn('skills/x/SKILL.md', 'Run node scripts/resolve-feature.js to resolve.\n');
  const sentence = prose.find((c) => c.text.includes('resolve-feature'));
  assert.equal(sentence.prose, true, 'an ordinary sentence is prose, checked by the prose rule');
  assert.equal(sentence.shellFenced, false, 'and it is not a shell context');

  // A four-space line under a list marker is a *continuation* of the list item in CommonMark, not a
  // code block, and this rule reads it as code anyway. That over-inclusion is deliberate and is the
  // fail-closed direction: the cost is that a wrapped list item carrying a resolver command must be
  // spelled canonically, and the alternative is a command that a reader can paste going unchecked.
  const inList = segmentsIn('skills/x/SKILL.md', '- some point\n    node scripts/resolve-feature.js\n');
  assert.equal(inList.find((c) => c.text.includes('resolve-feature')).prose, false,
    'a wrapped list continuation is over-included as code — the safe direction, pinned so a later '
    + 'change to the list-marker test is a visible decision rather than a silent narrowing');

  const block = segmentsIn('skills/x/SKILL.md', 'Do this:\n\n    node scripts/resolve-feature.js\n');
  const cmd = block.find((c) => c.text.includes('resolve-feature'));
  assert.ok(cmd, 'the indented line must produce a context at all');
  assert.equal(cmd.prose, false, 'a four-space indented block is a code context, not prose');
  assert.equal(cmd.shellFenced, true, 'and it is a shell context — that is what a reader pastes');
});

test('every fence CommonMark allows is stripped from the instruction surface', () => {
  // A gate that binds nothing must not satisfy the gate assertions. Stripping only unindented
  // ``` left two spellings that do: `~~~`, and a fence indented by up to three spaces. Supplied
  // text, because no file in the corpus uses either — a rule whose only evidence is what the repo
  // happens to contain is pinned by accident rather than by design.
  const gate = 'scan_error !== false ⇒ unknown, not empty — Need Human';
  for (const [label, doc] of [
    ['backtick fence', '# S\n\n```\n' + gate + '\n```\n'],
    ['tilde fence', '# S\n\n~~~\n' + gate + '\n~~~\n'],
    ['fence indented by three spaces', '# S\n\n   ```bash\n   ' + gate + '\n   ```\n'],
    ['tilde fence with an info string', '# S\n\n~~~json\n' + gate + '\n~~~\n'],
    ['unterminated fence runs to EOF', '# S\n\n```\n' + gate + '\n'],
  ]) {
    assert.ok(!stripFences(doc).includes('scan_error'), `${label}: fenced text still counted as an instruction`);
  }

  // Two controls. Prose keeps the gate — otherwise "strip everything" would pass the five above.
  assert.ok(stripFences(`# S\n\n${gate}\n`).includes('scan_error'));
  // And a fence does not swallow what follows it: the closing marker ends the block.
  assert.ok(stripFences('# S\n\n```\nexample\n```\n\n' + gate + '\n').includes('scan_error'));
});

test('the instruction surface keeps top-level prose and nothing else', () => {
  // Both directions, and the second one states a *contract* rather than a parser's behaviour: text
  // deeper than the top level does not count as a stated gate, whether or not CommonMark would call
  // it code. Every case is supplied text — no skill writes a gate any of these ways, and a rule
  // whose only evidence is what the corpus happens to contain is pinned by accident.
  const gate = 'scan_error !== false ⇒ unknown, not empty — Need Human';
  const cases = [
    // --- Inert: renders as code, or is deeper than the top level. Must not satisfy a gate check.
    ['top-level indented block', `# S\n\nDo this:\n\n    ${gate}\n`, false],
    ['tab-indented block', `# S\n\nDo this:\n\n\t${gate}\n`, false],
    ['deeper than four spaces', `# S\n\nDo this:\n\n        ${gate}\n`, false],
    ['blank line inside the block', `# S\n\nDo this:\n\n    first\n\n    ${gate}\n`, false],
    ['indented code inside a list item', `# S\n\n- Example:\n\n        ${gate}\n`, false],
    ['indented code carried by a blockquote', `# S\n\n>     ${gate}\n`, false],
    ['a fence carried by a blockquote', `# S\n\n> \`\`\`\n> ${gate}\n> \`\`\`\n`, false],
    // A fence opened on the marker line itself: the marker is consumed before the fence is looked
    // for, so `- ` + ``` is a fenced block inside the item, not a list item containing backticks.
    ['a fence opened on a list marker line', `# S\n\n- \`\`\`\n  ${gate}\n  \`\`\`\n`, false],
    // Five spaces after a marker is one padding space plus an indented code block — the one place
    // where "how many spaces follow the marker" changes the answer.
    ['five-space list-marker padding', `# S\n\n-     ${gate}\n`, false],
    ['a tab after a list marker', `# S\n\n-\t\`\`\`\n    ${gate}\n    \`\`\`\n`, false],
    ['a thematic break is not a list', `# S\n\n* * *\n\n     ${gate}\n`, false],
    ['an ATX heading does not open a paragraph', `# S\n\n# Heading\n    ${gate}\n`, false],
    ['a setext heading does not open a paragraph', `# S\n\nHeading\n-------\n    ${gate}\n`, false],
    ['an ordered marker that cannot interrupt a paragraph', `# S\n\nParagraph\n2. item\n\n      ${gate}\n`, false],
    // Raw HTML: its content is not Markdown, and `<pre>` is the tag whose whole point is code.
    ['a type-1 HTML block', `# S\n\n<pre><code>\n${gate}\n</code></pre>\n`, false],
    // An unclosed fence dies with its blockquote; the top-level backticks below it open a new one.
    ['a fence crossing a container boundary', `# S\n\n> \`\`\`\n> example\n\`\`\`\n${gate}\n`, false],

    // --- Instructions: top-level prose a reader is bound by.
    ['unindented prose', `# S\n\n${gate}\n`, true],
    ['prose in a list item', `# S\n\n- ${gate}\n`, true],
    ['prose in a checklist item', `# S\n\n- [ ] ${gate}\n`, true],
    ['prose in a blockquote', `# S\n\n> ${gate}\n`, true],
    ['prose indented three columns', `# S\n\n   ${gate}\n`, true],
    ['a new paragraph in a list item', `# S\n\n- Outer:\n\n  ${gate}\n`, true],
    ['prose after an indented block', `# S\n\nDo:\n\n    example\n\n${gate}\n`, true],
    ['prose after a fence', '# S\n\n```\nexample\n```\n\n' + `${gate}\n`, true],
    // A backtick fence's info string may not contain a backtick, so this opens nothing and the
    // prose below it survives — the failure direction where a stripper eats real instructions.
    ['an invalid backtick info string opens no fence', '# S\n\n```` bad`info\n' + `${gate}\n`, true],
    // The unclosed fence ended with its blockquote, so this is top-level prose, not fenced.
    ['prose after an unclosed fence in a blockquote', `# S\n\n> \`\`\`\n> example\n\n${gate}\n`, true],
  ];

  for (const [label, doc, isInstruction] of cases) {
    assert.equal(stripFences(doc).includes('scan_error'), isInstruction,
      isInstruction ? `${label}: real instruction text was dropped` : `${label}: inert text still counted as an instruction`);
  }
});

test('a block ends with the container it opened in, whichever container that was', () => {
  // Quote depth alone answered "how deeply quoted is this line" and was asked "has the block's
  // container ended" — three different questions in one. Each case below is a lifetime the depth
  // model got wrong, and each is a *different* container: a list item, a nested quote, and an HTML
  // block in a list. Supplied text; nothing in the corpus is shaped this way.
  const gate = 'scan_error !== false ⇒ unknown, not empty — Need Human';

  // The list item ends, so the unclosed fence ends with it and the top-level backticks open a NEW
  // fence rather than closing the old one. The gate is inside that new fence: inert.
  assert.ok(!stripFences(`# S\n\n- \`\`\`\n  example\n\`\`\`\n${gate}\n`).includes('scan_error'),
    'top-level backticks below a list-item fence open a new block, they do not close the old one');

  // Once a fence is open at one quote level, a deeper `>` is fence *content*. Reading it as a second
  // container makes the backticks after it look like a closer at another depth.
  assert.ok(!stripFences(`# S\n\n> \`\`\`\n> > \`\`\`\n> ${gate}\n`).includes('scan_error'),
    'a deeper quote marker inside an open fence is content, not a container that can close it');

  // The opposite direction, and it must fail loudly rather than silently: the HTML block ends with
  // its list item, so what follows is binding top-level prose.
  assert.ok(stripFences(`# S\n\n- <pre>\n  example\n\n${gate}\n`).includes('scan_error'),
    'an unclosed HTML block ends with its list item — prose after it still instructs');

  // And the control for the rule itself: a block whose container has *not* ended still contains
  // what follows, or "always close on the next line" would satisfy all three above.
  assert.ok(!stripFences(`# S\n\n> \`\`\`\n> ${gate}\n> \`\`\`\n`).includes('scan_error'),
    'a fence whose container is still open keeps its content');
});

test('every list marker and quote prefix the classifier claims to handle is exercised', () => {
  // The class this file has now missed twice: a branch that no input distinguishes from its
  // deletion. Each case below fails if its own alternative is dropped from the pattern.
  const gate = 'scan_error !== false ⇒ unknown, not empty — Need Human';
  const inert = [
    ['ordered marker with a dot', `# S\n\n1. \`\`\`\n   ${gate}\n   \`\`\`\n`],
    ['ordered marker with a paren', `# S\n\n1) \`\`\`\n   ${gate}\n   \`\`\`\n`],
    ['plus marker', `# S\n\n+ \`\`\`\n  ${gate}\n  \`\`\`\n`],
    ['asterisk marker', `# S\n\n* \`\`\`\n  ${gate}\n  \`\`\`\n`],
    ['two levels of blockquote', `# S\n\n> > \`\`\`\n> > ${gate}\n> > \`\`\`\n`],
    ['a script block', `# S\n\n<script>\n${gate}\n</script>\n`],
    ['a style block', `# S\n\n<style>\n${gate}\n</style>\n`],
    ['a textarea block', `# S\n\n<textarea>\n${gate}\n</textarea>\n`],
  ];
  for (const [label, doc] of inert) {
    assert.ok(!stripFences(doc).includes('scan_error'), `${label}: inert text still counted as an instruction`);
  }

  // `-foo` is not a list at all, so nothing is stripped and this stays ordinary prose — the control
  // that keeps "treat any leading punctuation as a marker" from passing the table above.
  assert.ok(stripFences(`# S\n\n-${gate}\n`).includes('scan_error'),
    'a marker character with no space after it is not a list marker');
});

test('a gate stated wholly inside inline code binds nobody', () => {
  // Block-level stripping cannot see this: one backtick span, or one `<code>` element, carrying the
  // whole gate. It renders as an example and satisfies every block-level check.
  const gate = 'scan_error !== false — the sets are unknown, not empty — Need Human';
  const wholly = [
    ['one inline code span', `# S\n\n\`${gate}\`\n`],
    ['a code element', `# S\n\n<code>\n${gate}\n</code>\n`],
    ['a double-backtick span', `# S\n\n\`\`${gate}\`\`\n`],
  ];
  for (const [label, doc] of wholly) {
    assert.doesNotMatch(prose(doc), /unknown, not empty/, `${label}: a gate inside code must not read as stated`);
    assert.doesNotMatch(prose(doc), /Need Human/, `${label}: its consequence is inside code too`);
    // And through the consumer check itself: `prose` is only load-bearing if the classifier calls
    // it. Reading the block raw would accept all three of these documents as a stated gate.
    assert.throws(() => assertStatesGate(doc, label), /must state condition/,
      `${label}: an example is not an instruction, whichever way the file is read`);
  }

  // The control, and it is how every real consumer writes the gate: the *condition* in a span, the
  // reading and the consequence in prose around it. Stripping spans wholesale would fail all 12.
  const real = '# S\n\n`scan_error !== false` ⇒ the sets are **unknown, not empty** — take the ⚠️ Need Human exit.\n';
  assert.match(prose(real), /unknown, not empty/, 'a condition in code with the reading in prose is a stated gate');
  assert.match(prose(real), /Need Human/);
});

test('a new sibling container ends the block inside the old one', () => {
  // Coordinates say "where"; these say "which". Both documents put the new container at exactly the
  // same depth and column as the old one, which is why a coordinate comparison alone read the new
  // fence's opener as the old fence's closer and let the code after it pass as prose.
  const gate = 'scan_error !== false — the sets are unknown, not empty — Need Human';

  assert.ok(!stripFences(`# S\n\n- \`\`\`\n  example\n- \`\`\`\n  ${gate}\n  \`\`\`\n`).includes('scan_error'),
    'a second list item ends the first — its backticks open a new fence, they do not close the old');

  assert.ok(!stripFences(`# S\n\n> \`\`\`\n> example\n\n> \`\`\`\n> ${gate}\n> \`\`\`\n`).includes('scan_error'),
    'an unquoted blank line ends the blockquote — the next `>` begins a different one');

  // The controls, and they are what stops "end the block whenever anything looks like a marker".
  // A dash inside fenced content is content, and a quoted blank line does not leave the quote.
  assert.ok(!stripFences(`# S\n\n- \`\`\`\n  - still code\n  ${gate}\n  \`\`\`\n`).includes('scan_error'),
    'a list marker at or past the content column is the block’s own content');
  assert.ok(!stripFences(`# S\n\n> \`\`\`\n> example\n>\n> ${gate}\n> \`\`\`\n`).includes('scan_error'),
    'a blank line that is still quoted does not end the blockquote');
});

test('a code span is closed by an equal-length backtick run or by nothing at all', () => {
  // Runs are whole tokens. Matching a run's *suffix* fails in both directions at once: it exposes
  // the tail of a span that CommonMark closes much later, and it invents a closer for a span that
  // CommonMark never closes, deleting visible prose.
  const inner = 'scan_error !== false `` the sets are unknown, not empty — Need Human ';
  assert.doesNotMatch(prose(`# S\n\n\`${inner}\`\n`), /unknown, not empty/,
    'a longer run inside a span is span content, not a closer');
  assert.doesNotMatch(prose(`# S\n\n\`${inner}\`\n`), /Need Human/);

  // No equal-length closer: CommonMark renders literal backticks and the text is ordinary prose.
  const unclosed = '# S\n\nReport this: `the sets are unknown, not empty — Need Human``\n';
  assert.match(prose(unclosed), /unknown, not empty/, 'a span with no equal-length closer is not a span');
  assert.match(prose(unclosed), /Need Human/);

  // An end tag may carry whitespace before its `>`, and `</code >` closed nothing under the old
  // pattern — so everything inside rendered as code while reading as prose to this file.
  const spaced = '# S\n\n<code>\nThe sets are unknown, not empty — Need Human\n</code >\n';
  assert.doesNotMatch(prose(spaced), /unknown, not empty/, '`</code >` closes a code element');

  // Controls: ordinary equal-length spans are still removed, and prose outside them survives.
  assert.doesNotMatch(prose('# S\n\n`unknown, not empty`\n'), /unknown, not empty/);
  assert.match(prose('# S\n\n`scan_error !== false` ⇒ unknown, not empty — Need Human\n'), /unknown, not empty/);
});

test('the gate is one statement, not three phrases that share a file', () => {
  // What three independent file-wide searches accept: a schema example, an unrelated sentence, and
  // an unrelated exit — a skill that never connects a non-false `scan_error` to an unreadable
  // corpus. Supplied text, because no consumer is written this way and the point is that none can be.
  const scattered = [
    '# S',
    '',
    'Payload schema example: `scan_error !== false`.',
    '',
    'When feature selection is ambiguous, the source sets are unknown, not empty.',
    '',
    'A network timeout takes the ⚠️ Need Human exit.',
    '',
  ].join('\n');
  // Through `assertStatesGate` — the same call the twelve consumers are judged by, not a local copy
  // of its logic. A copy would classify this document correctly and leave the consumer assertion
  // free to weaken to a bare `scan_error` search underneath it, with nothing turning red.
  assert.throws(() => assertStatesGate(scattered, 'a supplied document'), /must state condition/,
    'three unrelated phrases are not a stated gate');

  // The control, in the shape the corpus actually uses: all three parts in one block.
  const together = '# S\n\n`scan_error !== false` ⇒ the sets are **unknown, not empty** — take the ⚠️ Need Human exit.\n';
  assert.doesNotThrow(() => assertStatesGate(together, 'a supplied document'),
    'condition, reading and consequence in one block is a gate');
});

test('containers compose, so a quote opened inside a list item still hides its fence', () => {
  // A fence in a list and a fence in a quote were each covered; `- > ~~~` is both at once, and
  // consuming quotes before list markers could not see it. CommonMark renders every line below as
  // fenced code, so nothing here is an instruction to anybody.
  const composed = [
    ['a quote inside a list item', '# S\n\n- > ~~~\n  > `scan_error !== false` means %G%.\n  > ~~~\n'],
    ['an unequal-length closer', '# S\n\n- > ```\n  > `scan_error !== false` means %G%.\n  > ````\n'],
    ['a list item inside a quote', '# S\n\n> - ~~~\n>   `scan_error !== false` means %G%.\n>   ~~~\n'],
  ];
  for (const [label, doc] of composed) {
    assert.throws(() => assertStatesGate(doc.replace(/%G%/g, GATE_TEXT), label), /must state condition/,
      `${label}: a fence hidden by a container prefix would forge a gate`);
  }

  // The control: the same two container markers, no fence. This is a real instruction and must read
  // as one — over-stripping the prefix must not cost the corpus its nested gates.
  const nested = `# S\n\n- > \`scan_error !== false\` means ${GATE_TEXT}.\n`;
  assert.doesNotThrow(() => assertStatesGate(nested, 'a gate stated inside a quoted list item'));
});

test('a block ends where Markdown ends it, not only at a blank line', () => {
  // Four abutting blocks: a setext heading, a paragraph, an ATX heading, and a paragraph. No blank
  // line anywhere, and no single Markdown block carries all three contractual parts — so a reader
  // meets the condition under one heading and the consequence under another.
  const abutting = [
    'Schema condition: `scan_error !== false`',
    '---',
    'The source sets are unknown, not empty.',
    '# Unrelated timeout recovery',
    'Take the ⚠️ Need Human exit.',
    '',
  ].join('\n');
  assert.throws(() => assertStatesGate(abutting, 'abutting blocks'), /must state condition/,
    'blocks separated by a heading or a rule are not one statement');

  // The control, and the shape a real consumer uses: a numbered step whose table rows carry the
  // reading and the consequence. List markers and table rows must NOT split a block, or the corpus
  // fails for stating its gate the way it actually does.
  const step = [
    '4b. **`scan_error` gate**: read the marker.',
    '',
    '   | Marker | Reading | Consequence |',
    '   |--------|---------|-------------|',
    `   | \`unknown\` | \`scan_error !== false\` — ${GATE_TEXT} |`,
    '',
  ].join('\n');
  assert.doesNotThrow(() => assertStatesGate(step, 'a numbered step carrying a table'));
});

test('the condition the reader acts on is the one in the block, not one elsewhere in the file', () => {
  // The fail-open spelling, stated operatively, with the strict spelling present as an unrelated
  // schema example. A file-wide search for `!== false` is satisfied; the instruction a reader
  // follows still opens the gate on a payload that carries no such field at all.
  const failOpen = [
    '# S',
    '',
    `If \`scan_error === true\`, ${GATE_TEXT}.`,
    '',
    'Schema syntax elsewhere: `scan_error !== false`.',
    '',
  ].join('\n');
  assert.throws(() => assertStatesGate(failOpen, 'an operative `=== true`'), /must state condition/,
    'a strict spelling elsewhere in the file does not fix the condition in the block');

  // The control: same document, the operative condition corrected. Nothing else moves.
  const strict = failOpen.replace('`scan_error === true`', '`scan_error !== false`');
  assert.doesNotThrow(() => assertStatesGate(strict, 'an operative `!== false`'));
});

test('an opening tag carrying attributes is the same tag', () => {
  // Every earlier fixture wrote a bare `<code>` or `<script>`, so the alternatives that accept
  // `<code class=…>` and `<pre class=…>` were implemented and pinned by nothing: deleting them left
  // the suite green while making both of these inert examples read as instructions.
  const attributed = [
    ['a code element with a class', `# S\n\n<code class="example">scan_error !== false — ${GATE_TEXT}</code>\n`],
    ['a pre block with a class', `# S\n\n<pre class="example">\nscan_error !== false — ${GATE_TEXT}\n</pre>\n`],
    ['a self-closing-style opener', `# S\n\n<textarea readonly>\nscan_error !== false — ${GATE_TEXT}\n</textarea>\n`],
  ];
  for (const [label, doc] of attributed) {
    assert.throws(() => assertStatesGate(doc, label), /must state condition/,
      `${label}: markup with attributes is still markup`);
  }
});

test('leaving a list ends the fence inside it, wherever the quote markers line up', () => {
  // The composition coordinates could not tell apart: an unclosed fence inside a list-item
  // blockquote, then a *top-level* blockquote. Both sit at quote depth 1, column 0 — but leaving the
  // item ended its fence, so the second `> ~~~` opens a new one and the gate below it is code.
  const leftTheItem = [
    '# S',
    '',
    '- > ~~~',
    '  > example',
    '> ~~~',
    `> \`scan_error !== false\` means ${GATE_TEXT}.`,
    '> ~~~',
    '',
  ].join('\n');
  assert.throws(() => assertStatesGate(leftTheItem, 'a top-level quote below a list-item quote'),
    /must state condition/, 'the second fence is a new fence, so its content is code');

  // The control: the same shape without leaving the item, where the second `> ~~~` really does close
  // the first fence and the gate after it is prose.
  const stayed = leftTheItem.replace('> ~~~\n> `scan_error', '  > ~~~\n> `scan_error');
  assert.doesNotThrow(() => assertStatesGate(stayed, 'a closed fence inside the item'));

  // And the direction a length comparison alone cannot see. The unclosed fence opens inside a
  // blockquote; the list item below it occupies the same two columns but no quote, so CommonMark
  // ends the quote and the fence with it. Reading those two columns as "still inside" swallows a
  // real instruction — the failure here is a refused gate, not a forged one, which is why only a
  // positive case can catch it.
  const leftTheQuote = [
    '# S',
    '',
    '> ~~~',
    '> example',
    `- \`scan_error !== false\` means ${GATE_TEXT}.`,
    '',
  ].join('\n');
  assert.doesNotThrow(() => assertStatesGate(leftTheQuote, 'a list item below an unclosed quoted fence'),
    'leaving the blockquote ended its fence, so the item below it is prose');
});

test('every construct that ends a Markdown block ends one here', () => {
  // Each of these puts the three contractual parts in different rendered blocks with no blank line
  // between them. `---` was the only boundary any case exercised, so the other branches were
  // implemented and pinned by nothing.
  const split = [
    ['a link reference definition', `[schema]: /payload "scan_error !== false"\nThe sets are unknown, not empty — Need Human.\n`],
    ['a spaced thematic break', `Condition: \`scan_error !== false\`\n* * *\nThe sets are unknown, not empty — Need Human.\n`],
    ['an underscore break', `Condition: \`scan_error !== false\`\n___\nThe sets are unknown, not empty — Need Human.\n`],
    // Spaced, and out of a character that is not a list marker — the one spelling that reaches
    // `THEMATIC_BREAK`'s spaced form. `* * *` and `- - -` are consumed as markers and leave the line
    // empty, so they would split whatever that regex said.
    ['a spaced underscore break', `Condition: \`scan_error !== false\`\n_ _ _\nThe sets are unknown, not empty — Need Human.\n`],
    ['a setext level-1 underline', `Condition: \`scan_error !== false\`\n===\nThe sets are unknown, not empty — Need Human.\n`],
    ['a quoted blank line', `> Condition: \`scan_error !== false\`.\n>\n> The sets are unknown, not empty — Need Human.\n`],
  ];
  for (const [label, doc] of split) {
    assert.throws(() => assertStatesGate(`# S\n\n${doc}`, label), /must state condition/,
      `${label}: parts in different rendered blocks are not one statement`);
  }

  // The control: a quoted gate with no blank line inside it is one block and must still read as one.
  const quoted = `# S\n\n> \`scan_error !== false\` means ${GATE_TEXT}.\n`;
  assert.doesNotThrow(() => assertStatesGate(quoted, 'a gate stated inside a blockquote'));
});

test('the strict tokens are not the strict condition when a boolean surrounds them', () => {
  // The resolver can report an unreadable corpus *and* a resolved key, so a conjunction with the key
  // is false in exactly the case the gate exists for. The negation is the fail-open form written
  // backwards. Both keep the token sequence a search for `!== false` would find.
  const composed = [
    ['a conjunction with the key', `If \`scan_error !== false && key === null\`, ${GATE_TEXT}.`],
    ['a disjunction', `If \`scan_error !== false || docs_path === null\`, ${GATE_TEXT}.`],
    ['a negation', `If \`!(scan_error !== false)\`, ${GATE_TEXT}.`],
  ];
  for (const [label, body] of composed) {
    assert.throws(() => assertStatesGate(`# S\n\n${body}\n`, label), /must state condition/,
      `${label}: the boolean a reader evaluates is not the strict condition`);
  }

  // The controls, both of which a real document may write and neither of which changes the meaning:
  // a code span crossing a soft line break, and one carrying an explanation.
  const wrapped = `# S\n\nIf \`feature_context.scan_error\n!== false\`, ${GATE_TEXT}.\n`;
  assert.doesNotThrow(() => assertStatesGate(wrapped, 'a span across a soft line break'));
  const explained = `# S\n\nIf \`scan_error !== false\` — absence is a scan failure — ${GATE_TEXT}.\n`;
  assert.doesNotThrow(() => assertStatesGate(explained, 'a condition with its reason beside it'));
});

test('a fence closes only on its own marker, at its own length or longer', () => {
  // The rules the case table above cannot distinguish from their absence: every fence in it opens
  // and closes with three identical characters, so dropping the marker-character check or the
  // length check would leave all of it green while making any ``` or ~~~ close any other fence.
  const gate = 'scan_error !== false ⇒ unknown, not empty — Need Human';
  const stillFenced = [
    ['~~~ does not close a ``` fence', '# S\n\n```\nexample\n~~~\n' + `${gate}\n`],
    ['a shorter run does not close a longer fence', '# S\n\n````\nexample\n```\n' + `${gate}\n`],
    ['a closer may not carry an info string', '# S\n\n```\nexample\n``` js\n' + `${gate}\n`],
  ];
  for (const [label, doc] of stillFenced) {
    assert.ok(!stripFences(doc).includes('scan_error'), `${label}: the fence was closed by something that cannot close it`);
  }

  // And the control, or "nothing ever closes a fence" would satisfy all three above.
  assert.ok(stripFences('# S\n\n````\nexample\n`````\n' + `${gate}\n`).includes('scan_error'),
    'a longer run of the same character does close the fence');
});

test('a relative path to another skill is a graph edge; naming it in prose is not', () => {
  const citer = 'skills/tech-spec/references/native-feature-resolution.md';
  assert.ok(referencesIn(citer, 'The payload schema lives in ../../ask/SKILL.md.')
    .includes('skills/ask/SKILL.md'), 'a `../../<skill>/SKILL.md` link must attribute the edge');
  assert.ok(referencesIn(citer, 'See ../SKILL.md § Context-Aware Mode.')
    .includes('skills/tech-spec/SKILL.md'), '`../SKILL.md` resolves against the citing file');
  assert.ok(!referencesIn(citer, 'The ask skill answers questions; run /ask for it.')
    .includes('skills/ask/SKILL.md'), 'naming a skill without a path is not an edge');
});

test('the consumer list follows reference edges, not just each SKILL.md', () => {
  // Scanning only `skills/*/SKILL.md` for the set names left an escape wide enough to drive the
  // whole feature through: put the part that reads `current_authority` in a reference, link it,
  // and the skill is not a consumer — so it never owes the gate, and on an unreadable corpus it
  // reads the wrapper's empty sets as a complete answer. Membership is therefore taken over the
  // same transitive graph the permission check uses: a skill consumes the sets when *anything it
  // can load* names one.
  const found = new Set();
  for (const skill of skillDirs()) {
    if (consumesSets(surfacesOf(skill))) found.add(`skills/${skill}/SKILL.md`);
  }
  assert.deepEqual([...found].sort(), [...CONSUMERS].sort(),
    'CONSUMERS is out of step with the skills that can reach a source set. Add the skill and its '
    + '`scan_error !== false` gate together, or stop reaching the sets there.');

  // The edge really is what decides it — a surface naming a set attributes its readers, and the
  // owner alone is not the answer. Without this the derivation could have collapsed back to
  // "each SKILL.md" and still matched a hand-maintained list.
  const shared = 'skills/create-request/references/feature-context-resolution.md';
  assert.ok(namesASourceSet(mentions(shared)), 'fixture check: the shared reference names the sets');
  const borrowers = skillDirs().filter((sk) => sk !== 'create-request' && loadedSurfaces(sk).includes(shared));
  assert.ok(borrowers.length > 0, 'the shared reference is loaded by skills that do not own it');
  for (const skill of borrowers) {
    assert.ok(CONSUMERS.includes(`skills/${skill}/SKILL.md`),
      `${skill} loads a source-set reference and runs the resolver, so it must be a consumer`);
  }

  // On supplied text, because the corpus cannot distinguish these cases on its own.
  const naming = { rel: 'skills/x/references/a.md', text: 'Read `design_records` for the design.' };
  const fetching = { rel: 'skills/x/SKILL.md', text: '```bash\nnode scripts/resolve-feature.js\n```\n' };
  const commented = { rel: 'skills/x/SKILL.md', text: '<!-- design_records were considered here -->\n' };
  const fenced = { rel: 'skills/x/SKILL.md', text: '```json\n{"design_records": []}\n```\n' };
  assert.equal(consumesSets([naming]), true,
    'a set named in a loaded reference is consumed there, whoever fetched the payload');
  assert.equal(consumesSets([fetching]), false,
    'fetching without reading a set is /test-health — it gates on the field it does read');
  assert.equal(consumesSets([commented]), false, 'an HTML comment reaches no reader');
  assert.equal(consumesSets([fenced]), true,
    'a fenced payload example is how this repo shows what it reads — discovery keeps fences');
  assert.equal(consumesSets([]), false);
});

// `/test-health` reads no source set, so it is deliberately not in CONSUMERS — but it does invoke
// the resolver, and its Phase A used to branch on `has_tech_spec` alone. The failure payload sets
// that field false along with everything else, so an unreadable corpus reported as "no feature docs
// detected" and a real feature's coverage vanished behind a reassuring advisory. The gate binds
// wherever the payload is read, not only where the sets are.
test('test-health separates an unreadable corpus from a feature with no documents', () => {
  // Scoped to Phase A, and ordered. A file-wide regex is satisfied by the right words sitting
  // anywhere — including in prose far from the branch — so the old Phase A could be restored
  // verbatim underneath a correct sentence elsewhere and the test would stay green.
  const full = instructions('skills/test-health/SKILL.md');
  const phaseA = full.split(/^### Phase A\b/m)[1]?.split(/^### /m)[0];
  assert.ok(phaseA, 'test-health: no `### Phase A` section to check');
  const gate = phaseA.search(/scan_error\s*!==\s*false/);
  const legacy = phaseA.search(/has_tech_spec/);
  assert.ok(gate !== -1,
    'test-health: Phase A must gate on `scan_error !== false`, in Phase A itself');
  assert.ok(legacy === -1 || gate < legacy,
    'test-health: the `scan_error` gate must come before Phase A reads `has_tech_spec` — the '
    + 'failure payload sets that field false too, so reading it first answers the wrong question');
  assert.match(phaseA, /unknown, not absent|could not be read/,
    'test-health: the skip advisory must say the coverage is unknown, not that no docs exist');
});

// One gate, not three phrases that happen to appear in the same file. Three independent file-wide
// searches are satisfied by a payload-schema example naming `scan_error`, an unrelated sentence
// about ambiguity leaving the sets "unknown, not empty", and a network-timeout rule routing to Need
// Human — a skill that never says a non-false `scan_error` means an unreadable corpus. So the three
// parts must occur in **one block**, which is where a reader meets them.
//
// A function rather than an inline assertion so the co-location test above can drive this exact
// check with a document that must fail it: every real consumer passes, so the corpus alone cannot
// tell this check from a bare `/scan_error/` search.
function assertStatesGate(relOrText, label) {
  assert.ok(gateBlocks(relOrText).length > 0,
    `${label}: must state condition, reading and consequence together in one block, not scattered`);
}

test('every source-set consumer states the gate as an instruction, not in a comment or example', () => {
  for (const rel of CONSUMERS) assertStatesGate(rel, rel);
});

test('the gate is `!== false`, so a payload with no scan_error field is caught too', () => {
  // `scan_error === true` is the tempting form and it is wrong: a shell `|| echo '{}'` fallback
  // produces a payload with no such field, where `=== true` is false and the gate opens on a
  // payload that contains nothing at all.
  for (const rel of CONSUMERS) {
    assert.match(instructions(rel), /scan_error\s*!==\s*false|`!== false`/,
      `${rel}: must gate on !== false, not on === true`);
  }
});

test('the runbook step that carries the gate states the strict form in that row', () => {
  // File-wide regexes are satisfied by any line anywhere, so `| 2b |` could regress to `is true`
  // while another paragraph kept the file green. The step is where the reader acts, so the step is
  // what gets pinned.
  const row = instructions('skills/runbook/SKILL.md').split('\n')
    .find((l) => /^\|\s*2b\s*\|/.test(l));
  assert.ok(row, 'skills/runbook/SKILL.md: expected a `| 2b |` step row carrying the gate');
  assert.match(row, /scan_error\s*!==\s*false/, `the 2b row must gate on !== false: ${row}`);
  assert.match(row, /stop|Need Human/i, `the 2b row must say what to do: ${row}`);
});

test('the gate says a non-null key is not evidence the sets are complete', () => {
  // The specific misreading this exists to prevent: `scan_error` rides alongside a resolved `key`,
  // so a skill that gates on "did we resolve a feature" passes straight through it.
  const stated = CONSUMERS.filter((rel) =>
    /non-null `key`|`key` may still be present/.test(instructions(rel)));
  assert.deepEqual(stated, CONSUMERS,
    `every consumer must state it; missing from: ${CONSUMERS.filter((c) => !stated.includes(c))}`);
});

// Every role-aware surface: the five consumer skills, the two shared references they point at, and
// the source guide. Anything here that teaches `node …resolve-feature-cli.js` teaches a call whose
// failure the gate cannot see, whether it is a step or an example.
const ROLE_AWARE = [...CONSUMERS,
  'skills/create-request/references/feature-context-resolution.md',
  'skills/tech-brief/references/source-guide.md',
];

test('every role-aware surface invokes the wrapper, the single place the failure payload is defined', () => {
  // Two copies of a JSON fallback drift; one of them ends up as `{}` again. `resolve-feature.js`
  // owns it, so callers use a wrapper rather than the CLI plus their own `||` clause. Checked on
  // the raw text, since a fenced example teaches the same wrong command as a bare step does — but
  // prose *naming* the CLI ("canonical implementation …") is not an invocation, so only lines that
  // look like a command count.
  // Two detectors. The first is the one that matters: ANY line where `node` precedes the CLI is a
  // direct call, whatever the path is spelled like. The first version anchored on the literal
  // `scripts/` with an optional `${VAR}/` in front, so `node ./scripts/resolve-feature-cli.js` and
  // `node "$REPO_ROOT/scripts/resolve-feature-cli.js"` both walked past it — a role-aware surface
  // could bypass the wrapper, and with it the guaranteed `scan_error` payload, with no regression
  // to show for it.
  const CLI_INVOCATION = /\bnode\b.*resolve-feature-cli\.js/;
  // The second is the general command shape, used for the floor below and to catch a wrapper path
  // that is spelled wrong.
  const INVOCATION = /(^|[`("'\s])(bash|node)\s+\S*scripts\/resolve-feature[-.]/;
  // The detector is pinned directly, because a detector that matches nothing passes every loop
  // built on it. Both spellings Codex broke the first version with are here by name.
  for (const form of [
    'node scripts/resolve-feature-cli.js',
    'node ./scripts/resolve-feature-cli.js',
    'node "$REPO_ROOT/scripts/resolve-feature-cli.js"',
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-feature-cli.js --feature auth',
    '`node  scripts/resolve-feature-cli.js`',
  ]) {
    assert.ok(CLI_INVOCATION.test(form), `the detector must catch: ${form}`);
  }
  for (const form of [
    '**CLI module** (low-level, not the entrypoint — invoke the wrapper): `scripts/resolve-feature-cli.js`',
    'bash scripts/resolve-feature.sh --feature auth',
  ]) {
    assert.ok(!CLI_INVOCATION.test(form), `naming or wrapping is not a direct call: ${form}`);
  }
  // The rule is "whatever you invoke must be the wrapper", with a separate floor below so deleting
  // every invocation cannot pass this vacuously. `/feasibility-study` used to be the surface that
  // invoked nothing and read sets a caller was assumed to have resolved — an assumption its own
  // documented examples contradict, since it is invoked directly. It now has a Phase 0 of its own
  // and belongs in the floor.
  // No exemption. The first version carved one out for a line that labelled the CLI low-level and
  // said not to call it — which a real bad invocation launders itself through by appending the same
  // words: `**CLI** — do not call directly unless the wrapper is unavailable: node
  // scripts/resolve-feature-cli.js --feature x` passed. A surface that only NAMES the CLI writes
  // the bare path (`scripts/resolve-feature-cli.js`), which is not command-shaped and never reaches
  // this loop, so the exemption bought nothing it did not also give away.
  // The detectors above catch the shapes we thought of. They do not catch a shell continuation
  // (`node \\` then the path on the next line) or an interpreter behind a variable
  // (`NODE_BIN=node` … `"$NODE_BIN" "$CLI"`), and enumerating evasions is a losing game. So the
  // binding rule is an allowlist instead: in a role-aware surface, EVERY line that names the CLI at
  // all must be one of these exact lines. A new occurrence fails no matter how its interpreter is
  // spelled, and adding a legitimate mention is a deliberate edit to this list.
  const ALLOWED_CLI_MENTIONS = new Set([
    '**CLI module** (low-level, not the entrypoint — invoke the wrapper): `scripts/resolve-feature-cli.js`',
    'Input: /ask resolve-feature-cli.js 怎麼偵測 feature？',
  ]);
  for (const rel of ROLE_AWARE) {
    for (const line of raw(rel).split('\n')) {
      if (line.includes('resolve-feature-cli.js')) {
        assert.ok(ALLOWED_CLI_MENTIONS.has(line.trim()),
          `${rel}: names the CLI outside the allowlist — call the wrapper: ${line.trim()}`);
      }
      assert.ok(!CLI_INVOCATION.test(line),
        `${rel}: must call the wrapper, not the CLI directly: ${line.trim()}`);
      if (INVOCATION.test(line)) {
        assert.match(line, /resolve-feature\.(js|sh)/,
          `${rel}: must call a wrapper, not the CLI directly: ${line.trim()}`);
      }
    }
  }
  // The allowlist is only a control if it is exhaustive AND used: every entry must appear in some
  // role-aware surface, so a stale entry cannot sit there quietly widening the hole.
  const allText = ROLE_AWARE.map(raw).join('\n');
  for (const allowed of ALLOWED_CLI_MENTIONS) {
    assert.ok(allText.split('\n').some((l) => l.trim() === allowed),
      `stale allowlist entry, no surface contains it: ${allowed}`);
  }
  // The floor: these five do invoke it, and an empty match set here means the check above ran
  // against nothing.
  for (const rel of ['skills/ask/SKILL.md', 'skills/runbook/SKILL.md',
    'skills/architecture/SKILL.md', 'skills/tech-brief/SKILL.md',
    'skills/feasibility-study/SKILL.md']) {
    assert.ok(raw(rel).split('\n').some((l) => INVOCATION.test(l)),
      `${rel}: expected at least one resolver invocation`);
  }
});

test('no consumer still degrades a failed invocation to `{}`', () => {
  // The bypass that made the first version of this gate decorative: the skill invoked the resolver
  // as `... || echo '{}'`, so a resolver that could not run at all produced a payload the gate
  // could not recognise as a failure. Checked on the raw text — a fenced example teaches the same
  // wrong command as a bare line does.
  for (const rel of ROLE_AWARE) {
    const cmds = raw(rel).split('\n').filter((l) => l.includes('resolve-feature-cli.js'));
    for (const line of cmds) {
      assert.ok(!/\|\|\s*echo\s*'\{\}'/.test(line),
        `${rel}: falls back to {} — a payload the gate cannot recognise: ${line.trim()}`);
    }
  }
});

test('the wrapper builds its failure payload from the shared shape, not a hand-written literal', () => {
  // It used to be a JSON string literal in the shell script — a second copy of the schema, which is
  // how a field gets added to the resolver and forgotten in the fallback. `EMPTY_CONTEXT()` is the
  // one definition; the wrapper only sets `scan_error`.
  const js = raw('scripts/resolve-feature.js');
  assert.match(js, /EMPTY_CONTEXT\(\)/, 'the payload must come from the shared factory');
  assert.match(js, /scan_error: true/, 'and must mark the corpus unknown');
  assert.ok(!/"scan_error":true/.test(js), 'not as a hand-written JSON literal');
});

test('the shared reference documents the flag', () => {
  // The shared reference is the contract the skills point at — one canonical copy since the
  // `/tech-spec` duplicate was merged into it. A skill repeating the gate while the reference omits
  // it would leave the next consumer uninformed.
  for (const rel of ['skills/create-request/references/feature-context-resolution.md']) {
    const content = raw(rel);
    assert.match(content, /"scan_error": false/, `${rel}: must appear in the output schema`);
    const text = instructions(rel);
    assert.match(text, /unknown, not empty/, `${rel}: must state what a non-false value means`);
    // The reference is the contract the skills point at, so it owes the same strict form and the
    // same invocation the skills owe. Without these, reverting it to `node … || echo '{}'` left
    // every test in this file green.
    assert.match(text, /scan_error\s*!==\s*false|`!== false`/, `${rel}: must gate on !== false`);
    assert.match(text, /node scripts\/resolve-feature\.js/,
      `${rel}: must name the node wrapper, the entrypoint every caller is permitted to run`);
  }
});

test('the negative control — a skill that does not consume the sets is not required to gate', () => {
  // Deleting the gate from every consumer must not leave this file green by accident, and a file
  // that never reads the sets must not be dragged into the rule. `/smart-commit` reads none of
  // them, so it is the control: it must NOT be in CONSUMERS, and it does not mention the flag.
  const control = 'skills/smart-commit/SKILL.md';
  assert.ok(!CONSUMERS.includes(control), 'control must not be in the consumer list');
  assert.ok(!raw(control).includes('scan_error'),
    'control skill should not mention scan_error — if it now reads the sets, add it to CONSUMERS');
});

test('the wrapper emits exactly one payload however the CLI fails', () => {
  // The shape-level tests read the script text; this runs it. `node cli || echo '<fallback>'`
  // passes those and still fails here: the CLI's partial stdout is already on the wire when the
  // fallback fires, so the consumer receives two concatenated documents and `JSON.parse` throws
  // before any gate can read `scan_error`.
  //
  // Isolated by directory, not by PATH: the wrapper spawns `process.execPath`, so a stub `node` on
  // PATH intercepts the WRAPPER rather than the CLI — the first version of this test shimmed the
  // wrong process and passed for the wrong reason. A temp directory holding the real wrapper, a
  // symlink to the real `scripts/lib`, and a stub `resolve-feature-cli.js` replaces exactly the one
  // process under test.
  const repo = resolve(__dirname, '../..');
  const dir = mkdtempSync(join(tmpdir(), 'resolve-feature-wrapper-'));
  try {
    copyFileSync(join(repo, 'scripts/resolve-feature.js'), join(dir, 'resolve-feature.js'));
    symlinkSync(join(repo, 'scripts/lib'), join(dir, 'lib'), 'dir');
    const stub = join(dir, 'resolve-feature-cli.js');
    const run = () => spawnSync(process.execPath, [join(dir, 'resolve-feature.js')], { encoding: 'utf8' });

    const cases = [
      ['dies mid-write', 'process.stdout.write(\'{"key":"auth","design_reco\');\nprocess.exit(1);\n'],
      ['exits 0 with garbage', 'process.stdout.write("not json at all");\n'],
      ['writes nothing and dies', 'process.exit(3);\n'],
    ];
    for (const [label, body] of cases) {
      writeFileSync(stub, body);
      const res = run();
      assert.equal(res.status, 0, `${label}: the wrapper must exit 0 so callers reach the gate`);
      const payload = JSON.parse(res.stdout);   // throws on two concatenated documents
      assert.equal(payload.scan_error, true, `${label}: a failed CLI means the sets are unknown`);
      assert.deepEqual(payload.design_records, [], `${label}: must not leak the partial document`);
    }

    // The control. Without it every assertion above would also pass on a wrapper that ignored the
    // CLI and always printed the failure payload. It emits a COMPLETE payload on purpose: the first
    // version used `{key, scan_error, design_records}` and so blessed a partial shape as "healthy",
    // which is exactly the contract hole the shape check below closes.
    const healthy = {
      key: 'auth', source: 'branch', confidence: 'high', docs_path: 'docs/features/auth',
      doc_inventory: [],
      canonical_docs: { tech_spec: null, architecture: null, feasibility: null, requirements: null },
      current_authority: [],
      design_records: [{ file: '2-tech-spec.md' }, { file: '3-architecture.md' }],
      work_records: [], history_records: [], scan_error: false,
      has_tech_spec: true, has_requirements: false, has_requests: false,
    };
    writeFileSync(stub, `process.stdout.write(${JSON.stringify(JSON.stringify(healthy))});\n`);
    const ok = JSON.parse(run().stdout);
    assert.equal(ok.scan_error, false, 'a healthy CLI must pass through unchanged');
    assert.equal(ok.key, 'auth');
    assert.deepEqual(ok.design_records, healthy.design_records);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Discovered, not hand-listed, and **recursive**. Two of the callers this file was supposed to
// cover — `/test-health` and `/codex-code-review` — were absent from the hand-maintained array, and
// a hand-maintained array cannot see a caller added tomorrow. The first discovered version scanned
// only `skills/*/SKILL.md`, which still missed every `references/*.md`: three of the thirteen
// surfaces that instruct the resolver are references, and one of them
// (`skills/runbook/references/discovery-heuristics.md`) is a step-by-step procedure, not prose.
const SKILLS_ROOT = resolve(__dirname, '../..', 'skills');

function skillDirs() {
  return readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function markdownUnder(dir, prefix, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) markdownUnder(abs, rel, out);
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

/** Every instruction surface a skill ships — `SKILL.md` and every `references/**.md` beneath it. */
function skillSurfaces() {
  return markdownUnder(SKILLS_ROOT, 'skills', []).sort();
}

/**
 * Which skills can load `rel`, and therefore owe the permission for a command printed in it?
 *
 * A `SKILL.md` answers for itself. A reference is loaded by the skill that owns the directory
 * **and** by any skill whose `SKILL.md` names it — `feature-context-resolution.md` lives under
 * `/create-request` and is read by six other skills, so a command in it has to be runnable by all of
 * them, not just by its owner.
 *
 * Two spellings both count, and the bare tail needs one guard. External readers write the full
 * `skills/create-request/references/feature-context-resolution.md`; a skill referring to *its own* copy
 * writes the bare `references/feature-context-resolution.md`. Counting the bare tail unguarded
 * would make every owner of a same-named reference a governor of every other copy — so a skill
 * that owns `skills/<self>/<tail>` is credited only for its own file.
 *
 * **Reachability is transitive.** The first version followed `SKILL.md → reference` only, so a
 * reference pulled in by *another* reference was attributed to nobody but its owner — one hop of
 * indirection and the permission rule stopped applying. `discovery-heuristics.md` naming
 * `feature-context-resolution.md` is exactly that shape. The edges are walked to a fixpoint.
 */
const _refsCache = new Map();

/**
 * The surfaces `rel` cites — references **and `SKILL.md` files**, by full path or by the bare
 * `references/<name>.md` tail.
 *
 * `SKILL.md` targets were excluded on the reasoning that a skill answers for itself. It does, but a
 * *reference* citing one does not: adding `See @skills/architecture/SKILL.md` to `/tech-spec`'s
 * command-free reference reconnected `/tech-spec` to a file that both prints the resolver command
 * and links the shared reference, and every structural and permission assertion stayed green. One
 * hop through a `SKILL.md` was a hole in the graph, so `SKILL.md` files are nodes like any other.
 */
/**
 * `../SKILL.md` and `../../ask/SKILL.md` name a skill just as `skills/ask/SKILL.md` does; only the
 * spelling differs, and a graph that reads one and not the other attributes the commands behind a
 * relative link to nobody. Resolved against the citing file's directory, so the same text means
 * different things in different files — which is what a relative link is.
 */
function relativeSkillTargets(rel, text) {
  const dir = rel.split('/').slice(0, -1).join('/');
  return [...text.matchAll(/\.{1,2}\/[\w./-]*SKILL\.md/g)]
    .map((m) => posix.normalize(`${dir}/${m[0]}`));
}

function referencesFrom(rel) {
  if (_refsCache.has(rel)) return _refsCache.get(rel);
  let text;
  try { text = raw(rel); } catch { _refsCache.set(rel, []); return []; }
  const out = referencesIn(rel, text);
  _refsCache.set(rel, out);
  return out;
}

/**
 * The edge rule itself, over text supplied by the caller. Split out from `referencesFrom` so it can
 * be exercised on text that is not on disk: both relative links this repository contains today point
 * back at their own skill, so the relative branch could be deleted with every test still green —
 * a guarantee no case demonstrates is a comment, not a guard.
 */
function referencesIn(rel, text) {
  const citer = rel.split('/')[1];
  const out = [];
  for (const target of skillSurfaces()) {
    if (target === rel) continue;
    // **Naming another skill's `SKILL.md` by path is an edge, `@` or not.** The `@`-only rule was
    // tried and is too weak: this repo uses bare paths normatively too ("the cascade defined in
    // `skills/tech-spec/SKILL.md`", "canonical source: `skills/best-practices/SKILL.md`"), and no
    // reading of the surrounding prose separates those from a citation — the same lesson the
    // deleted non-executing pledge taught. So every mention counts, and the two spellings that are
    // *not* loads say so structurally instead: an illustration uses a `<name>` placeholder, and a
    // "see also" uses the slash-command form (`/codex-review-fast`), neither of which is a path.
    if (target.endsWith('/SKILL.md')) {
      if (text.includes(target) || relativeSkillTargets(rel, text).includes(target)) out.push(target);
      continue;
    }
    if (text.includes(target)) { out.push(target); continue; }
    const tail = target.slice(target.indexOf('/references/') + 1);
    if (!text.includes(tail)) continue;
    // A bare tail resolves to the citing skill's own copy when it has one.
    if (existsSync(join(SKILLS_ROOT, citer, tail))) {
      if (citer === target.split('/')[1]) out.push(target);
      continue;
    }
    out.push(target);
  }
  return out;
}

/**
 * The surfaces a skill can load, transitively — **every** edge, including ones to another skill's
 * `SKILL.md`.
 *
 * Excluding `SKILL.md` edges was tried and is wrong, for the reason the whole file keeps
 * relearning: the graph cannot tell delegation from reuse. "Route to `/ask`" and "follow the
 * feature-resolution section of `skills/ask/SKILL.md` inline" are the same edge, and only the
 * second consumes the payload. Excluding the edge assumes the first; including it assumes the
 * second. One of those errs toward a skill that reads an unreadable corpus as empty, and the other
 * toward a skill carrying a gate it never reaches — so the choice is fail-closed, and a skill that
 * genuinely only delegates stops being a consumer by not naming the file, which is a real edit
 * rather than a declaration about itself.
 */
function loadedSurfaces(skill) {
  const start = `skills/${skill}/SKILL.md`;
  const visited = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const next of referencesFrom(stack.pop())) {
      if (!visited.has(next)) { visited.add(next); stack.push(next); }
    }
  }
  return [...visited];
}

/**
 * Does a skill holding these surfaces owe the `scan_error` gate? It does when **any** surface it
 * can load names a source set.
 *
 * A stricter rule was tried — also require a resolver command somewhere reachable — and it is
 * unsound in both directions. A skill can be handed a payload it did not fetch: `detect-scope.js`
 * produces a `feature_context` that its consumers read without ever invoking the resolver, so
 * requiring the command excuses exactly the skill most likely to misread empty arrays. And the
 * command may co-occur lexically in a file cited for an unrelated section, which manufactures
 * consumers. Naming a set is the fact that tracks consumption; issuing a command is a fact about
 * fetching, and the two are not the same question.
 *
 * Text is supplied rather than read so the rule is exercised on inputs the corpus does not contain.
 *
 * @param {Array<{rel: string, text: string}>} surfaces
 */
function consumesSets(surfaces) {
  return surfaces.some((s) => namesASourceSet(discoverySurface(s.text)));
}

const surfacesOf = (skill) => loadedSurfaces(skill).map((rel) => ({ rel, text: raw(rel) }));

function governingSkills(rel) {
  const owner = rel.split('/')[1];
  const set = new Set([owner]);
  for (const skill of skillDirs()) {
    const visited = new Set();
    const stack = [`skills/${skill}/SKILL.md`];
    while (stack.length) {
      const cur = stack.pop();
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const next of referencesFrom(cur)) {
        if (next === rel) { set.add(skill); stack.length = 0; break; }
        if (!visited.has(next)) stack.push(next);
      }
    }
  }
  return [...set].sort();
}

/**
 * There is no "non-executing reader" escape hatch, and its removal is the point.
 *
 * It used to exist because `feature-context-resolution.md` lived in `skills/tech-spec/references/`
 * while `/tech-spec` grants `Bash(git:*)` and no node permission — the owner could not run the
 * reference it owned. The hatch let that stand by declaring the intent in prose, and every round of
 * review found another way to reverse the declaration from elsewhere in the same file: an HTML
 * comment, a `~~strikethrough~~`, and finally a plain later sentence ("Despite the pledge above,
 * execute every command in the shared reference instead."), which no whole-line grammar can refuse.
 *
 * Prose cannot carry a mechanical guarantee about what a skill will not do. The file moved instead:
 * the shared algorithm now lives with `/create-request`, which can run everything in it, and
 * `/tech-spec` has its own command-free `references/native-feature-resolution.md`. The mismatch is
 * gone from the graph rather than annotated inside it, so the pairing rule below applies to every
 * governing skill with no exceptions to police.
 */

const allowedToolsOf = (skill) => {
  let text;
  try { text = raw(`skills/${skill}/SKILL.md`); } catch { return undefined; }
  return text.split('\n').find((l) => l.startsWith('allowed-tools:'));
};

// Two entrypoints, one contract. `resolve-feature.js` is the default because the migrated research
// skills grant `Bash(node:*)` and not `Bash(bash:*)`; `resolve-feature.sh` is a shim over the same
// file for `!` context blocks and for the callers that grant bash and (in `/codex-code-review`'s
// case) no node at all. Neither permission is universal, which is the whole reason this pairing is
// asserted rather than assumed.
//
// **This is an allowlist, and the inversion is the point.** Three consecutive review rounds blocked
// on the same defect at a new boundary — `/usr/bin/bash`, then a quoted path, then an escaped dot, a
// path assembled from a variable, and a process substitution inside a diagram label. Each fix
// removed one spelling and left the space of remaining spellings the same size. A denylist over
// shell syntax cannot converge, because the set of ways to write a command is not enumerable by the
// person defending against it.
//
// So the rule is now: any command context mentioning the resolver must match one of the permitted
// forms below **exactly**. Everything else fails, including spellings nobody has thought of. Adding
// a legitimate new form is a deliberate edit here, which is the cost this design accepts in
// exchange for failing closed.
const ENTRYPOINTS = {
  '.js': { name: 'node wrapper', head: 'node', permission: /Bash\(node:\*\)/ },
  '.sh': { name: 'shell shim', head: 'bash', permission: /Bash\(bash:\*\)/ },
};
const UNRESTRICTED_BASH = /(^|,)\s*Bash\s*(,|$)/;

/**
 * The permitted spellings. Each names the entrypoint it resolves to, so the permission pairing
 * reads the answer off the matched form instead of re-parsing the text.
 *
 * The argument tail is an explicit character class, not `.*`. `.*` swallowed `| jq .key` and
 * `&& echo ok`, which turns a bare invocation into a pipeline — permitted under `Bash(node:*)` only
 * by accident of starting with `node`, and not what any of these steps mean. Excluding `|`, `;`,
 * `&`, backtick and parentheses by construction also means `$(`, `<(` and `>(` cannot appear, so
 * substitution needs no rule of its own. Placeholders (`<key>`, `$ARGUMENTS`, `[--feature <key>]`)
 * are what the remaining characters are for.
 *
 * `<` and `>` are permitted only as a **matched `<…>` placeholder pair**. Allowing them anywhere in
 * the tail admitted `> /tmp/out` and `<<EOF`: the first is operationally broken (the skill receives
 * no JSON and cannot apply the `scan_error` gate at all), and both contradict this file's own claim
 * that a resolver command is a bare invocation. `TAIL` builds the two canonical forms so the
 * placeholder grammar is written once.
 *
 * The first two entries are the canonical invocations. `TOOL_CALL` is `/ask`'s `Bash("node …")` step, which
 * is the same command inside the tool-call syntax that skill documents its steps in. `ARROW` is a
 * mermaid sequence-diagram label: pinned to the whole line, because "a line matching the arrow
 * grammar" was an exemption twice over and both times it turned out to admit something that runs
 * (`$(bash …)`, then `<(bash …)`). A pinned form admits neither, and needs no list of what to reject.
 */
// One argument tail, built once: optional args made of the permitted characters, plus placeholders.
// `> file`, `>> file`, `<<EOF` and `< file` are operators and match nothing here.
//
// **A placeholder's contents are a language of their own, not "whatever is between `<` and `>`".**
// `<[^<>]*>` was the first spelling and it re-admitted the operators it was written to exclude:
// `node scripts/resolve-feature.js <(printf x)> /dev/null` reads to this regex as one balanced
// placeholder and to both zsh and bash as process substitution followed by a redirect — the skill
// receives no JSON and cannot apply the `scan_error` gate, which is the exact failure the tail
// restriction exists to prevent. The inner class is therefore the finite language the repository
// actually uses — `<key>`, `<docs_path>`, `<the feature key from $ARGUMENTS>` — words, spaces and
// `$`. No `(`, no `/`, no `.`: a placeholder names a thing, it does not run one.
const PLACEHOLDER = '<[\\w $-]*>';
const TAIL = (cmd) => new RegExp(`^${cmd}(?: (?:[-\\w./=\${}[\\] ]|${PLACEHOLDER})*)?$`);

const ALLOWED_COMMANDS = [
  { re: TAIL('node scripts\\/resolve-feature\\.js'), ext: '.js', label: 'node wrapper' },
  { re: TAIL('bash scripts\\/resolve-feature\\.sh'), ext: '.sh', label: 'shell shim' },
  {
    re: /^Bash\(node scripts\/resolve-feature\.js\)$/,
    // The literal keeps its quotes: `/ask` writes its steps as tool calls, and `Bash("…")` is the
    // spelling that executes. Normalization strips the quotes to reach the same form, so the two
    // regexes differ by exactly the characters normalization removed.
    lit: /^Bash\("node scripts\/resolve-feature\.js"\)$/,
    ext: '.js', label: 'tool-call step',
  },
  { re: /^[\w-]+ ?-{1,2}[>x)]{1,2} ?[\w-]+: node scripts\/resolve-feature\.js$/, ext: '.js', label: 'diagram label' },
];

/** A bare path with no command around it: prose naming the file, in a non-shell context. */
const BARE_PATH = /^[\w./${}-]*resolve-feature(?:-cli)?\.(?:js|sh)$/;

/** Does this text name an interpreter at all? If not, it cannot be an invocation. */
const INTERPRETER_TOKEN = /(^|\/)(?:bash|sh|zsh|node|env)$/;
const namesInterpreter = (text) => text.split(/[\s(){}[\]<>,;&|]+/).some((t) => INTERPRETER_TOKEN.test(t));

/**
 * Normalize the way a shell would, before deciding anything.
 *
 * Quote removal came first (`bash "scripts/resolve-feature.sh"` restarted the scan at the `"`, and
 * `scripts/resolve-""feature.sh` hid the literal path entirely). Backslash removal is the same
 * failure with a different character: `bash scripts/resolve-feature\.sh` runs, and the escaped dot
 * kept the path from matching. Both are the shell's own normalization, done here so the check sees
 * what the shell would.
 */
function normalizeCommand(text) {
  return text.replace(/["']/g, '').replace(/\\(?=\S)/g, '').replace(/\s+/g, ' ').trim();
}

const SHELL_FENCE = /^\s*```(bash|sh|shell|zsh|console)\s*$/;
const FENCE_CLOSE = /^\s*```\s*$/;

/**
 * A trailing backslash continues a shell command onto the next line, and `bash \` /
 * `  ./scripts/resolve-feature.sh` matched no detector at all while being exactly the forbidden
 * invocation. Continuations are folded before anything is matched; the reported line number is the
 * first physical line, which is where a reader looks.
 */
function foldContinuations(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    let joined = lines[i];
    const start = i;
    while (/\\\s*$/.test(joined) && i + 1 < lines.length) {
      i += 1;
      joined = `${joined.replace(/\\\s*$/, ' ')}${lines[i].replace(/^\s+/, '')}`;
    }
    out.push({ line: joined, lineNo: start + 1, raw: lines[start] });
  }
  return out;
}

/**
 * The **command contexts** of one surface: the spans of text a reader acts on.
 *
 * Inline `` `…` `` spans are contexts wherever they appear — including inside a fence, which is what
 * lets a fenced prose line carry a correctly-spelled command without the whole sentence having to
 * match a command form. What is left of a fenced line after its spans are removed is still a
 * context, so relabelling a shell block ```text or ```mermaid launders nothing and an unclosed fence
 * hides nothing. Outside a fence, the sentence around the spans is prose, checked by a separate
 * rule rather than by the command allowlist.
 */
function commandContexts(rel) {
  return segmentsIn(rel, raw(rel));
}

/**
 * The same segmentation over text supplied by the caller — split out for the same reason
 * `referencesIn` was: the four-space indented-block rule below could be deleted with every test
 * still green, because no skill in the repository currently writes a resolver command that way.
 * The rule exists for the one that will.
 */
function segmentsIn(rel, source) {
  const out = [];
  let inShellFence = false;
  let inAnyFence = false;
  for (const { line, lineNo, raw: physical } of foldContinuations(source)) {
    if (inAnyFence) {
      if (FENCE_CLOSE.test(physical)) { inAnyFence = false; inShellFence = false; continue; }
    } else if (/^\s*```/.test(physical)) {
      inAnyFence = true;
      inShellFence = SHELL_FENCE.test(physical);
      continue;
    }
    // A four-space CommonMark indented block is a code block too, and treating it as prose let a
    // two-line `export RESOLVER=…` / `bash "$RESOLVER.sh"` pair sit in a skill unexamined — paste
    // it into one shell and it invokes the forbidden shim.
    const indented = !inAnyFence && /^ {4,}\S/.test(line) && !/^ *[-*+|>] /.test(line);
    const codeLike = inAnyFence || indented;
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      out.push({ rel, lineNo, text: m[1], fenced: codeLike, shellFenced: inShellFence, span: true });
    }
    const residue = line.replace(/`[^`]*`/g, '');
    out.push({
      rel, lineNo, text: residue, fenced: codeLike, shellFenced: inShellFence || indented,
      prose: !codeLike,
    });
  }
  return out;
}

/**
 * Classify one command context against the allowlist.
 *
 * `skip` — no resolver mention. `assignment` — a resolver path bound to a variable, which is
 * forbidden outright: `RESOLVER=scripts/resolve-feature` followed by `bash "$RESOLVER.sh"` puts the
 * real invocation in a line containing no resolver text at all, so no scanner over text can see it.
 * Banning the construction is the only place that stays checkable. `mention` — a path named where
 * nothing could run it. `command` — an allowlisted form, carrying its entrypoint. `unrecognized` —
 * the fail-closed bucket, and the whole reason for the inversion.
 */
function classifyContext(ctx) {
  const literal = ctx.text.trim();
  const norm = normalizeCommand(ctx.text);
  if (!norm.includes('resolve-feature')) return { kind: 'skip', norm, literal };
  // Any binding of a resolver path to a variable, in any spelling. The invocation that follows
  // (`bash "$RESOLVER.sh"`) contains no resolver text at all, so no line-local scanner can see it;
  // refusing the binding is where the pair is still visible. `export`, `declare -r` and `readonly`
  // are the same construction wearing a prefix.
  if (/(^|\s)\w+=\S*resolve-feature/.test(norm)) return { kind: 'assignment', norm, literal };
  const allowed = ALLOWED_COMMANDS.find((f) => f.re.test(norm));
  if (allowed) {
    // **Detected on the normalized text, admitted only on the literal.** Normalization exists so an
    // evasion cannot hide (`bash "scripts/…"`, `resolve-feature\.js`, an NBSP separator all reach
    // the check). It must not also *launder*: those three spellings are respectively one filename
    // containing spaces, a path with a literal backslash, and a string the shell does not split —
    // none of them runs the command they normalize to. Admitting them would approve instructions
    // that read correct and cannot execute, which is the defect this whole file exists to catch,
    // arriving through the allowlist.
    if (!ALLOWED_COMMANDS.some((f) => (f.lit || f.re).test(literal))) {
      return { kind: 'unrecognized', norm, literal, reason: 'normalizes to a permitted form but is not written as one' };
    }
    return { kind: 'command', norm, literal, entry: ENTRYPOINTS[allowed.ext], label: allowed.label };
  }
  // A shell fence is a block an agent copies verbatim, so every line in one is a command — a bare
  // path there runs the script just as surely as naming the interpreter does.
  if (!ctx.shellFenced && !namesInterpreter(norm) && (BARE_PATH.test(norm) || !ctx.span)) {
    return { kind: 'mention', norm, literal };
  }
  return { kind: 'unrecognized', norm, literal };
}

function contextsIn(rel) {
  return commandContexts(rel).map((ctx) => ({ ...ctx, ...classifyContext(ctx) }));
}

const allContexts = () => skillSurfaces().flatMap(contextsIn);

/** Contexts that instruct rather than name — everything the pairing rule governs. */
const commandContextsOf = (rel) => contextsIn(rel).filter((c) => c.kind === 'command');

test('every resolver command is bound to a skill permitted to run it', () => {
  // Permission is a property of a command, not of a file. An earlier version computed "which
  // entrypoints does this FILE use" and checked the permission for each, so one correct
  // `node scripts/resolve-feature.js` anywhere in a file — prose, diagram, checklist — satisfied the
  // node permission while the two *actual* procedure commands were switched to a forbidden shim.
  const all = allContexts();
  const cmds = all.filter((c) => c.kind === 'command');
  // Floor: the scan must find real work. A broken walk would otherwise pass every loop below.
  assert.ok(cmds.length >= 12,
    `expected at least 12 resolver invocations across skills/**, found ${cmds.length}`);
  assert.ok(new Set(cmds.map((c) => c.rel)).size >= 6,
    `expected at least 6 distinct surfaces, found ${new Set(cmds.map((c) => c.rel)).size}`);
  // And the walk must reach references, not just SKILL.md — the gap Codex found.
  assert.ok(cmds.some((c) => c.rel.includes('/references/')),
    'the scan must cover references/**, where a missed procedure command hides');

  // The fail-closed buckets, reported before the pairing so the message names the real problem.
  for (const c of all.filter((x) => x.kind === 'unrecognized')) {
    assert.fail(`${c.rel}:${c.lineNo}: not a permitted resolver spelling — see ALLOWED_COMMANDS: ${c.norm}`);
  }
  for (const c of all.filter((x) => x.kind === 'assignment')) {
    assert.fail(`${c.rel}:${c.lineNo}: a resolver path held in a variable is invisible to every text-level check: ${c.norm}`);
  }

  for (const { rel, lineNo, norm, entry } of cmds) {
    for (const skill of governingSkills(rel)) {
      const allowed = allowedToolsOf(skill);
      if (allowed === undefined) continue;           // no frontmatter list ⇒ nothing is restricted
      if (UNRESTRICTED_BASH.test(allowed)) continue; // unrestricted Bash runs either entrypoint
      assert.match(allowed, entry.permission,
        `${rel}:${lineNo}: prints the ${entry.name} (${norm}), but /${skill} loads this file and cannot run it — ${allowed}`);
    }
  }
});

// P1 (round 16): the round-15 repair was a `chmod -x`, and a mode bit is not a test. A bare
// `scripts/resolve-feature.sh` in prose is classified `mention` — harmless — and that classification
// is only sound while the file cannot execute on its own. `chmod +x` restores the bypass with every
// scan test still green, so the invariant is pinned here rather than inferred from the checkout.
// Both entrypoints: the contract is `bash scripts/resolve-feature.sh` and `node
// scripts/resolve-feature.js`, so neither needs the bit, and each shebang is for readers.
test('neither resolver entrypoint is executable, so a bare path cannot be an invocation', () => {
  for (const rel of ['scripts/resolve-feature.sh', 'scripts/resolve-feature.js']) {
    const mode = statSync(resolve(__dirname, '../..', rel)).mode;
    assert.equal(mode & 0o111, 0,
      `${rel} is executable (mode ${(mode & 0o777).toString(8)}). A bare \`./${rel}\` then runs, `
      + 'and this file classifies a bare path as a harmless mention. Run `chmod -x` on it, or change '
      + 'that classification.');
  }
});

test('the allowlist rejects the spellings that broke each previous denylist', () => {
  // The regression bank. Every entry is a real command Codex executed against a previous version of
  // this file, and each one was invisible to the detector of its round. They are checked as data
  // rather than by re-mutating the repo, so the evidence survives the fix that closed them.
  const forbidden = [
    '/usr/bin/bash scripts/resolve-feature.sh',      // r12: unlisted interpreter path
    'command bash scripts/resolve-feature.sh',        // r12: interpreter behind a builtin
    'RESOLVER=scripts/resolve-feature',               // r14: path constructed in a variable
    'S-xFR: $(bash scripts/resolve-feature.sh)',      // r13: substitution in a diagram label
    'S-xFR: <(bash scripts/resolve-feature.sh)',      // r14: process substitution in a label
    'node scripts/resolve-feature-cli.js',            // the CLI, which bypasses the failure payload
    'exec node scripts/resolve-feature.js',
    'env node scripts/resolve-feature.js',
  ];
  for (const text of forbidden) {
    const k = classifyContext({ text, span: true, shellFenced: true }).kind;
    assert.ok(k === 'unrecognized' || k === 'assignment',
      `must not be accepted as a permitted spelling: ${text} (got ${k})`);
  }
  // The other half of the bank: spellings that *normalize* to a permitted command but are not
  // written as one. Detection normalizes so a disguised spelling cannot hide; admission does not,
  // so a disguised spelling cannot be laundered into a permitted one either.
  //
  // **Most of these do run** — `bash "scripts/resolve-feature.sh"`, `bash scripts/resolve-feature\.sh`
  // and `node  scripts/…` (two spaces) all exit 0 from a shell, because quoting one argument does
  // not make it a filename with spaces, a backslash before an ordinary character is dropped, and
  // repeated spaces are one separator. An earlier version of this comment claimed they were inert,
  // which was wrong and is worth stating plainly: the rule here is a **canonical-spelling policy**,
  // not an inertness claim. One spelling per command keeps the permission pairing decidable, and a
  // document that means to run the resolver has no reason to reach for any of these. The two that
  // genuinely are broken say so on their own lines (`> /tmp/out`, `<<EOF`).
  for (const text of [
    'bash "scripts/resolve-feature.sh"',              // r13: quoted path
    'bash scripts/resolve-""feature.sh',              // r13: path split by empty quotes
    'bash scripts/resolve-feature\\.sh',              // r14: escaped dot
    '"node scripts/resolve-feature.js"',              // r15: whole command quoted
    'node scripts/resolve-feature\\.js',              // r15: literal backslash in the path
    'node scripts/resolve-feature.js',           // r15: NBSP, which the shell does not split on
    'node  scripts/resolve-feature.js',               // r15: not the canonical spacing
    'node scripts/resolve-feature.js > /tmp/out',     // r15: redirection — the skill gets no JSON
    'node scripts/resolve-feature.js <<EOF',          // r15: heredoc
    // r16: reads to a `<[^<>]*>` placeholder rule as one balanced placeholder, and to zsh and bash
    // as process substitution plus a redirect. Runs, exits 0, and the skill gets no JSON.
    'node scripts/resolve-feature.js <(printf harmless)> /dev/null',
    'node scripts/resolve-feature.js <(bash -c id)>/dev/null',
    'export RESOLVER=scripts/resolve-feature',        // r15: assignment behind a prefix
    'declare -r RESOLVER=scripts/resolve-feature',
    'readonly RESOLVER=scripts/resolve-feature',
  ]) {
    const k = classifyContext({ text, span: true, shellFenced: true }).kind;
    assert.ok(k === 'unrecognized' || k === 'assignment',
      `must not be admitted as a permitted spelling: ${JSON.stringify(text)} (got ${k})`);
  }
  // And the permitted ones must still be permitted — an allowlist that rejects everything is a
  // suite-wide no-op wearing a passing grade.
  for (const text of [
    'node scripts/resolve-feature.js',
    'node scripts/resolve-feature.js --feature statusline-config',
    'bash scripts/resolve-feature.sh',
    'Bash("node scripts/resolve-feature.js")',
    'S->>FR: node scripts/resolve-feature.js',
  ]) {
    assert.equal(classifyContext({ text, span: true, shellFenced: false }).kind, 'command',
      `must be accepted: ${text}`);
  }
});

test('an unformatted invocation cannot escape the pairing rule by dropping its backticks', () => {
  // The command allowlist runs on fenced lines and inline code spans. Bare prose is not held to it,
  // because "the wrapper `scripts/resolve-feature.js` emits …" is a sentence, not an instruction —
  // so the one hole is an instruction written without any formatting at all. Refused here on the
  // interpreter shape, with a boundary of "any non-word character": `<code>bash …</code>` and
  // `[bash …](…)` are both instruction contexts, and both begin right after a character a
  // hand-listed separator class did not contain.
  const BARE = /(^|[^\w-])[\w./-]*\b(?:bash|sh|zsh|node|env)\s+\S*resolve-feature/;
  for (const rel of skillSurfaces()) {
    for (const ctx of commandContexts(rel)) {
      if (!ctx.prose) continue;
      assert.ok(!BARE.test(normalizeCommand(ctx.text)),
        `${rel}:${ctx.lineNo}: an invocation outside any code span is unchecked by the allowlist — wrap it in backticks or a fence: ${ctx.text.trim()}`);
    }
  }
});

test('no skill governs a resolver command it is not permitted to run', () => {
  // The structural replacement for the deleted escape hatch. The hatch existed for exactly one
  // pairing — `/tech-spec` governing `feature-context-resolution.md` — and the fix was to break
  // that edge rather than to excuse it. This asserts the edge stays broken: `/tech-spec` reaches no
  // resolver command at all, and its own reference is command-free.
  const reachable = skillSurfaces().filter((rel) => governingSkills(rel).includes('tech-spec'));
  assert.ok(reachable.length >= 2,
    `expected /tech-spec to govern its own SKILL.md and references, found ${reachable.length}`);
  assert.ok(reachable.includes('skills/tech-spec/references/native-feature-resolution.md'),
    'the reader graph must reach the command-free reference /tech-spec was given');
  for (const rel of reachable) {
    const cmds = commandContextsOf(rel);
    assert.deepEqual(cmds.map((o) => `${rel}:${o.lineNo} ${o.norm}`), [],
      `/tech-spec grants no node permission, so nothing in its reader graph may instruct the resolver`);
  }
  // And the shared algorithm must have left that graph — not merely lost its commands. A file that
  // teaches the resolver belongs with an owner that can run it.
  assert.ok(!reachable.includes('skills/create-request/references/feature-context-resolution.md'),
    '/tech-spec must not reach the shared reference; it has its own command-free copy');
  assert.equal(existsSync(resolve(__dirname, '../../skills/tech-spec/references/feature-context-resolution.md')), false,
    'the old command-bearing copy under skills/tech-spec/references/ must be gone, not just unreferenced');
});

test('a resolver command is a bare invocation, not a shell compound', () => {
  // `Bash(node:*)` matches a command that *starts* with `node`. An
  // `if [ -n "$X" ]; then FEATURE_JSON=$(node …); fi` block is a shell compound: it reads as a
  // correct instruction and cannot execute under that grant — the same unexecutable-instruction
  // defect as a missing permission, wearing different clothes.
  //
  // The allowlist makes this structural rather than a pattern hunt: a compound is not one of the
  // permitted forms, so it lands in `unrecognized` and the pairing test fails on it. What is
  // asserted here is the two halves that rule depends on — that compounds really are rejected, and
  // that the shell fences really are being found.
  for (const text of [
    'if [ -n "$X" ]; then FEATURE_JSON=$(node scripts/resolve-feature.js); fi',
    'FEATURE_JSON=$(node scripts/resolve-feature.js)',
    'export FEATURE_JSON=$(node scripts/resolve-feature.js)',
    'node scripts/resolve-feature.js | jq .key',
    'node scripts/resolve-feature.js && echo ok',
  ]) {
    const k = classifyContext({ text, span: false, shellFenced: true }).kind;
    assert.notEqual(k, 'command', `a shell compound is not a bare invocation: ${text} (got ${k})`);
  }
  const fenced = allContexts().filter((c) => c.shellFenced && c.kind === 'command');
  // Floor: fence detection must actually find the shell blocks. A broken fence regex would make the
  // allowlist unreachable for exactly the contexts that matter most.
  assert.ok(fenced.length >= 6,
    `expected at least 6 fenced resolver commands, found ${fenced.length} — fence detection is broken`);
  for (const c of fenced) {
    assert.match(c.norm, /^(bash|node) scripts\/resolve-feature\.(sh|js)/,
      `${c.rel}:${c.lineNo}: a shell block must hold a bare invocation: ${c.norm}`);
  }
});

test('no resolver caller degrades a failed invocation to a fallback payload', () => {
  // The failure the wrapper exists to remove. Checked as "no `||` fallback on a resolver command
  // line" — enumerating spellings loses: `|| echo '{}'`, `|| echo "{}"`, `|| printf '{}'` and
  // `|| cat empty.json` are the same defect, and the first version caught only the first.
  // Prose that *prohibits* the fallback names it too, so only command-shaped lines count.
  for (const { rel, lineNo, norm: text } of allContexts().filter((c) => c.kind === 'command')) {
    assert.ok(!/\|\|/.test(text),
      `${rel}:${lineNo}: a \`||\` fallback replaces the wrapper's payload contract: ${text.trim()}`);
  }
});

test('the failure payload is built outside the failure domain it reports', () => {
  // The wrapper used to `require('./lib/feature-resolver')` for `EMPTY_CONTEXT`, which transitively
  // loads `doc-classifier`, the taxonomy loader and the metadata parser. A load-time error anywhere
  // in that graph killed the wrapper before `main()` ran — exit 1, no JSON, no `scan_error` — so
  // the one file whose job is surviving the resolver's failures was inside their blast radius.
  const shape = raw('scripts/lib/context-shape.js');
  const requires = [...shape.matchAll(/\brequire\s*\(/g)];
  assert.deepEqual(requires.map((m) => m[0]), [],
    'scripts/lib/context-shape.js must require nothing — that is the entire point of the file');

  // All three quote forms. The first version matched `require('…')` only, so injecting
  // `require("./lib/feature-resolver")` re-armed the hole with the allowlist still green — the
  // boundary was documented and unpinned at the same time.
  const wrapper = raw('scripts/resolve-feature.js');
  const imported = [...wrapper.matchAll(/\brequire\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)]
    .map((m) => m[2]).sort();
  assert.deepEqual(imported, ['./lib/context-shape', 'child_process', 'path'],
    'the wrapper may import only node built-ins and the dependency-free shape module');
  // And no dynamic form, which the allowlist above cannot see at all.
  const dynamic = [...wrapper.matchAll(/\brequire\s*\(\s*[^'"`\s)]/g)];
  assert.deepEqual(dynamic.map((m) => m[0]), [],
    'the wrapper must not build a module path at runtime — the allowlist cannot check one');
});

test('the wrapper survives a load failure in the resolver graph it reports on', () => {
  // The static allowlist says which modules the wrapper *names*; this proves what happens when the
  // forbidden graph is broken. Both are needed: the allowlist alone was green while the wrapper
  // secretly imported `feature-resolver`, because on a healthy tree that import works.
  const repo = resolve(__dirname, '../..');
  const dir = mkdtempSync(join(tmpdir(), 'resolve-feature-blast-'));
  try {
    copyFileSync(join(repo, 'scripts/resolve-feature.js'), join(dir, 'resolve-feature.js'));
    copyFileSync(join(repo, 'scripts/resolve-feature-cli.js'), join(dir, 'resolve-feature-cli.js'));
    const lib = join(dir, 'lib');
    mkdirSync(lib);
    copyFileSync(join(repo, 'scripts/lib/context-shape.js'), join(lib, 'context-shape.js'));
    // Every other module in the graph is replaced by one that throws at load time — a missing
    // dependency, a syntax error and an initialisation failure all present exactly this way.
    for (const name of ['feature-resolver.js', 'doc-classifier.js', 'doc-metadata.js']) {
      writeFileSync(join(lib, name), 'throw new Error("simulated load failure");\n');
    }
    const res = spawnSync(process.execPath, [join(dir, 'resolve-feature.js')], { encoding: 'utf8' });
    assert.equal(res.status, 0, 'the wrapper must still exit 0 so callers reach the gate');
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.scan_error, true, 'a broken resolver graph means the corpus is unknown');
    assert.deepEqual(payload.history_records, [], 'and the full shape must still arrive');
    assert.equal(payload.key, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every field of the agreed shape is load-bearing, one at a time', () => {
  // The spawn-level cases below use payloads missing several fields at once, so deleting any single
  // check in `isContextShape` still left them rejected — the validator could be weakened one field
  // at a time with the suite green. Dropping each field from a complete payload in turn is the
  // control that actually pins them, and it is cheap enough to be exhaustive.
  const { EMPTY_CONTEXT, isContextShape } = require('../../scripts/lib/context-shape');
  const complete = EMPTY_CONTEXT();
  assert.ok(isContextShape(complete), 'the canonical empty payload must be accepted');

  for (const key of Object.keys(complete)) {
    const missing = { ...complete };
    delete missing[key];
    assert.equal(isContextShape(missing), false, `dropping \`${key}\` must be rejected`);
  }
  // And the four canonical keys individually — `canonical_docs.tech_spec` on a bare `{}` is
  // `undefined`, which a consumer reads as "no tech spec" rather than as a broken payload.
  for (const key of ['tech_spec', 'architecture', 'feasibility', 'requirements']) {
    const partial = { ...complete, canonical_docs: { ...complete.canonical_docs } };
    delete partial.canonical_docs[key];
    assert.equal(isContextShape(partial), false, `dropping \`canonical_docs.${key}\` must be rejected`);
  }
  // Type confusion, not just absence: a present-but-wrong field is the harder failure to see.
  assert.equal(isContextShape({ ...complete, scan_error: 'false' }), false, 'scan_error must be boolean');
  assert.equal(isContextShape({ ...complete, design_records: {} }), false, 'a set must be an array');
  assert.equal(isContextShape({ ...complete, has_tech_spec: 1 }), false, 'has_* must be boolean');
  assert.equal(isContextShape({ ...complete, source: null }), false, 'source must be a string');
  assert.equal(isContextShape({ ...complete, key: 7 }), false, 'key must be a string or null');
  // Entry contents, one level down. `design_records: [1, 2]` cleared "it is an array" and put
  // `undefined` into a Markdown link; `canonical_docs.tech_spec = {file}` cleared "it is an object"
  // while `has_tech_spec` still derived `true` from it — a payload naming a tech spec with no path.
  assert.equal(isContextShape({ ...complete, design_records: [1] }), false,
    'a set entry must be an object with a `file`');
  assert.equal(isContextShape({ ...complete, doc_inventory: [{ type: 'tech_spec' }] }), false,
    'an inventory entry without `file` must be rejected');
  assert.equal(isContextShape({
    ...complete, canonical_docs: { ...complete.canonical_docs, tech_spec: { file: '2-tech-spec.md' } },
  }), false, 'a canonical entry without `path` must be rejected');
  // The positive direction: a populated, fully-formed payload is accepted.
  assert.ok(isContextShape({
    ...complete, key: 'auth', docs_path: 'docs/features/auth', confidence: 'high',
    design_records: [{ file: '2-tech-spec.md', type: 'tech_spec', role: 'Current authority' }],
    has_tech_spec: true,
    canonical_docs: {
      ...complete.canonical_docs,
      tech_spec: { file: '2-tech-spec.md', path: 'docs/features/auth/2-tech-spec.md' },
    },
  }), 'a populated payload must still be accepted');
});

test('the wrapper refuses a parseable payload that is not the agreed shape', () => {
  // "Parseable JSON" is too weak a contract: `7`, `[]`, `null` and `{"scan_error":false}` all parse,
  // and a consumer reading `payload.design_records.map(...)` out of any of them throws — the exact
  // TypeError the full-shape contract exists to prevent, arriving through the success path.
  const repo = resolve(__dirname, '../..');
  const dir = mkdtempSync(join(tmpdir(), 'resolve-feature-shape-'));
  try {
    copyFileSync(join(repo, 'scripts/resolve-feature.js'), join(dir, 'resolve-feature.js'));
    symlinkSync(join(repo, 'scripts/lib'), join(dir, 'lib'), 'dir');
    const stub = join(dir, 'resolve-feature-cli.js');
    const run = () => spawnSync(process.execPath, [join(dir, 'resolve-feature.js')], { encoding: 'utf8' });

    for (const [label, emitted] of [
      ['a scalar', '7'],
      ['an array', '[]'],
      ['null', 'null'],
      ['a partial object carrying scan_error: false', '{"scan_error":false}'],
      ['the six-array object Codex passed through', '{"scan_error":false,"doc_inventory":[],"current_authority":[],"design_records":[],"work_records":[],"history_records":[]}'],
      ['a complete shape whose canonical_docs is a bare {}', '{"key":null,"source":"none","confidence":null,"docs_path":null,"doc_inventory":[],"canonical_docs":{},"current_authority":[],"design_records":[],"work_records":[],"history_records":[],"scan_error":false,"has_tech_spec":false,"has_requirements":false,"has_requests":false}'],
      ['every set but one', '{"scan_error":false,"doc_inventory":[],"current_authority":[],"design_records":[],"work_records":[]}'],
      ['scan_error as a string', '{"scan_error":"false","doc_inventory":[],"current_authority":[],"design_records":[],"work_records":[],"history_records":[]}'],
    ]) {
      writeFileSync(stub, `process.stdout.write(${JSON.stringify(emitted)});\n`);
      const payload = JSON.parse(run().stdout);
      assert.equal(payload.scan_error, true, `${label}: must not pass through as success`);
      assert.deepEqual(payload.history_records, [], `${label}: must be replaced by the full shape`);
    }

    // The control: a complete shape passes through untouched, including its contents. Without it
    // every assertion above also passes on a wrapper that rejects everything.
    const full = {
      key: 'auth', source: 'branch', confidence: 'high', docs_path: 'docs/features/auth',
      doc_inventory: [{ file: "2-tech-spec.md" }],
      canonical_docs: { tech_spec: null, architecture: null, feasibility: null, requirements: null },
      current_authority: [], design_records: [{ file: '2-tech-spec.md' }],
      work_records: [], history_records: [], scan_error: false,
      has_tech_spec: true, has_requirements: false, has_requests: false,
    };
    writeFileSync(stub, `process.stdout.write(${JSON.stringify(JSON.stringify(full))});\n`);
    const ok = JSON.parse(run().stdout);
    assert.equal(ok.scan_error, false, 'a complete payload must pass through unchanged');
    assert.deepEqual(ok.design_records, [{ file: '2-tech-spec.md' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the shell shim holds no second copy of the failure payload', () => {
  // Two implementations of a fallback drift, and the one that drifts is the one nobody reads. The
  // shim forwards; `resolve-feature.js` owns the contract.
  const sh = raw('scripts/resolve-feature.sh');
  assert.match(sh, /exec node "\$SCRIPT_DIR\/resolve-feature\.js"/,
    'the shim must delegate to the node wrapper');
  assert.ok(!/scan_error":true/.test(sh),
    'the shim must not carry its own fallback payload');
});
