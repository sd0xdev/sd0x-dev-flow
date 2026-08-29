'use strict';

// R8: pins the override-contract migration — the live-precedence header on both override
// templates, the heading → tier mapping and 4-step resolution hierarchy published in the
// parent rules, Anchor non-overridability, mixed-tier handling, and fail-closed attribution.
// Removing a mapping row, downgrading Anchor supremacy, or reverting the precedence
// declaration to an HTML comment fails here by design.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  atxHeadingName, documentSections, fencedLines, liveLines, liveText, sectionAt,
  structuralViolations, toLines,
} = require('../helpers/markdown-structure');

const root = resolve(__dirname, '../..');
const autoLoop = readFileSync(resolve(root, 'rules/auto-loop.md'), 'utf8');
const testing = readFileSync(resolve(root, 'rules/testing.md'), 'utf8');
const autoLoopTpl = readFileSync(resolve(root, 'rules/auto-loop-project.md'), 'utf8');
const testingTpl = readFileSync(resolve(root, 'rules/testing-project.md'), 'utf8');
// The tech spec is read through liveText with fences KEPT live: the `override_templates` JSON
// mapping is legitimately documented as a code block and a reader sees it. HTML comments are
// blanked, because prose moved into one is gone from the rendered document while every raw
// `assert.match(spec, …)` below would still find it.
const spec = liveText(
  readFileSync(resolve(root, 'docs/features/rule-override-pattern/2-tech-spec.md'), 'utf8'),
  { fencesCount: true }
);
const specRaw = readFileSync(
  resolve(root, 'docs/features/rule-override-pattern/2-tech-spec.md'),
  'utf8'
);
// The Anchor Register is normative prose a model must read, so it is masked with fences hidden:
// an obligation demoted into a comment or demoted into an example block is no longer an
// obligation, and a raw match would certify it anyway.
const discretion = liveText(readFileSync(resolve(root, 'rules/discretion.md'), 'utf8'));

/** A parent rule's `## <heading>` section, with the extraction itself verified: the heading must
 *  occur exactly once and be **live** — not inside a fenced example or an HTML comment.
 *
 *  A raw `indexOf` finds the text either way, so wrapping `## Override Contract` in `<!-- … -->`
 *  left every hierarchy and mapping assertion below passing while the section had been stripped
 *  from model context. That is the precise defect R8 exists to fix; certifying it would be the
 *  worst false pass this file could produce. */
function section(doc, heading) {
  // Both the heading search and the terminator run over the MASKED document, so a `## Fake`
  // hidden in a fence or a comment can neither satisfy the lookup nor cut the section short —
  // cutting it short is the more dangerous half, because contradictory prose after the fake
  // heading stays in the real section while never reaching an assertion.
  const masked = toLines(liveText(doc));
  const at = masked
    .map((l, i) => (atxHeadingName(l, 2) === heading ? i : -1))
    .filter((i) => i !== -1);
  const rawCount = toLines(doc).filter((l) => atxHeadingName(l, 2) === heading).length;
  assert.deepEqual(rawCount, 1, `section "## ${heading}" must exist exactly once`);
  assert.deepEqual(at.length, 1,
    `section "## ${heading}" must be live text, not commented out or fenced`);
  // Hidden body lines keep liveText()'s NUL, which preserves length and is not whitespace: a
  // fenced example inside a section is legitimate, but nothing here may assert against one, and
  // blanking would let a bounded pattern match across the gap the hidden text used to fill.
  const body = [];
  for (let i = at[0] + 1; i < masked.length; i += 1) {
    if (atxHeadingName(masked[i], 1) || atxHeadingName(masked[i], 2)) break;
    body.push(masked[i]);
  }
  assert.ok(body.join('').replace(/\u0000/g, '').trim().length > 0,
    `section "## ${heading}" has no live body — it is commented out or fenced, so anything asserted about it would be dead text`);
  return body.join('\n');
}

// Strict three-column table parser (same closure discipline as discretion-tiers.test.js):
// consumes every pipe-line so a smuggled column or malformed row fails instead of being
// filtered away. The Kind column was added when the doc review established that none of the
// shipped auto-loop template headings is a same-heading section replacement — calling them all
// "full replacement" described a mechanism the scaffold never uses, so each row now has to name
// its kind and its consumer.
function parseMappingTable(sectionText) {
  const pipeLines = sectionText.split('\n').filter((l) => l.trim().startsWith('|'));
  assert.ok(pipeLines.length >= 2, 'mapping table must have a header and separator');
  const toCells = (line) => {
    const parts = line.split('|');
    assert.equal(parts[0].trim(), '', `row must start with a pipe: ${line}`);
    assert.equal(parts[parts.length - 1].trim(), '', `row must end with a pipe: ${line}`);
    assert.equal(parts.length, 5, `row must have exactly 3 cells: ${line}`);
    return parts.slice(1, -1).map((c) => c.trim());
  };
  assert.deepEqual(toCells(pipeLines[0]), ['Override heading', 'Kind — consumed by', 'Tier'],
    'mapping header drifted');
  assert.match(pipeLines[1], /^\|[-\s|]+\|$/, `second line must be the separator: ${pipeLines[1]}`);
  const rows = pipeLines.slice(2).map(toCells);
  for (const [heading, kind] of rows) {
    assert.match(kind, /^(Header|Setting|Section replacement) — \S/,
      `${heading}: Kind cell must declare one of the three kinds AND name its consumer`);
  }
  return rows;
}

/** Every ## heading in an override template, whether live or inside a comment block.
 *  Example-value lines like `<!-- ## Plan Review: enabled -->` carry a colon and are
 *  values, not headings — excluded by the character class.
 *
 *  Comments count here and fences do not, and the asymmetry is the point: a commented heading is
 *  the scaffold's own dormant form — uncommenting it is how a user activates the setting — while
 *  a heading inside a fenced example is illustration that will never be uncommented into a live
 *  section. Counting the latter would let a documented example satisfy "this template ships the
 *  heading". */
function templateHeadings(content) {
  const fenced = fencedLines(content);
  const out = [];
  toLines(content).forEach((line, i) => {
    if (fenced[i]) return;
    const m = line.match(/^(?:<!--\s*)?##\s+([^:<>]+?)(?:\s*-->)?\s*$/);
    if (m) out.push(m[1].trim());
  });
  return out;
}

/** Heading name from a mapping-table cell like `` `## Tier` `` — unwrap the code span, then parse.
 *  Returns null for a non-heading cell such as `preamble (synthetic section)`. Source lines go
 *  through `atxHeadingName()` directly, which does NOT strip backticks: a standalone `` `## Tier` ``
 *  line is inline code, not a section, and only a table cell's backticks are the table's own
 *  formatting. */
function mappingHeadingName(cell) {
  const inner = cell.trim().replace(/^`(.*)`$/s, '$1');
  return atxHeadingName(inner);
}

/** Everything before a template's first **live** `##` — where the precedence declaration must
 *  live. Cutting at the first `^## ` regardless of context would end the preamble at a heading
 *  shown inside a fenced example, hiding a declaration that sits after it. */
function preamble(content) {
  const lines = toLines(content);
  const live = liveLines(content);
  const idx = lines.findIndex((l, i) => live[i] && atxHeadingName(l, 2) !== null);
  return (idx === -1 ? lines : lines.slice(0, idx)).join('\n');
}

test('atxHeadingName when parsing → the formatting variants CommonMark accepts all yield one name', () => {
  // The structural Setting/Section-replacement check is only as strong as this parser: any real
  // heading it fails to recognize is a parent section that silently does not invalidate a
  // Setting classification.
  for (const variant of ['## Tier', '   ## Tier', '##\tTier', '## Tier ##', '##   Tier   ']) {
    assert.equal(atxHeadingName(variant), 'Tier', `variant must parse to "Tier": ${JSON.stringify(variant)}`);
  }
  assert.equal(atxHeadingName('## Adequacy Mode (project-only extension — not in testing.md core)'),
    'Adequacy Mode (project-only extension — not in testing.md core)', 'punctuation and dashes survive intact');
  for (const notAHeading of ['# Tier', '### Tier', '    ## Tier', '##Tier', '## ', 'text ## Tier', '`## Tier`']) {
    assert.equal(atxHeadingName(notAHeading), null, `must not parse as a level-2 heading: ${JSON.stringify(notAHeading)}`);
  }
  // The backtick-wrapped form is a mapping-table cell, not a section — only that path unwraps it.
  assert.equal(mappingHeadingName('`## Tier`'), 'Tier', 'a mapping cell unwraps its code span');
  assert.equal(mappingHeadingName('  `## Test Pyramid`  '), 'Test Pyramid', 'surrounding cell padding is tolerated');
  assert.equal(mappingHeadingName('preamble (synthetic section)'), null, 'a non-heading row yields no name');
});

test('documentSections when parsing → a fenced example heading is not a real section', () => {
  // The existence and non-existence assertions below both rest on this: if a ```-fenced
  // `## Test Pyramid` counted, deleting the genuine heading would still satisfy the check, and a
  // documentation example of `## Tier` in auto-loop.md would wrongly invalidate its Setting row.
  const doc = [
    '# Doc',
    '## Real Section',
    '',
    '```markdown',
    '## Fenced Example',
    '```',
    '',
    '~~~',
    '## Tilde Fenced',
    '~~~',
    '',
    '`## Inline Code Line`',
    '## Second Real Section',
  ].join('\n');
  assert.deepEqual(documentSections(doc), ['Real Section', 'Second Real Section'],
    'only unfenced, non-code-span level-2 headings count');

  // Mismatched closers. Each of these escaped a single-boolean toggle: the "closing" line is not a
  // valid closer, so the fence must still be open and the heading must stay out of the inventory.
  const mismatched = [
    ['```\n~~~\n## Leaked\n```', 'a ~~~ line does not close a ``` fence'],
    ['````\n```\n## Leaked\n````', 'a shorter run does not close a longer opener'],
    ['```\n```still-code\n## Leaked\n```', 'a closer may carry nothing but the marker'],
    ['```js\n## Leaked', 'an unclosed fence runs to end of document'],
    ['<!--\n## Leaked\n-->', 'a multiline HTML comment is not document structure'],
    ['- ```md\n  ## Leaked\n  ```', 'a fence nested in a list item is still a fence'],
    ['1. ~~~\n   ## Leaked\n   ~~~', 'an ordered-list marker too'],
  ];
  for (const [src, why] of mismatched) {
    assert.deepEqual(documentSections(src), [], why);
  }

  // …and the valid closers must actually close, or every fence swallows the rest of the file.
  assert.deepEqual(documentSections('```js\n## Fenced\n```\n## After'), ['After'],
    'an info-string opener closes on a bare marker of the same character');
  assert.deepEqual(documentSections('~~~\n## Fenced\n~~~~\n## After'), ['After'],
    'a longer closer of the same character is valid');
  assert.deepEqual(documentSections('``` not `a` fence\n## After'), ['After'],
    'a backtick info string containing a backtick is ordinary text, not an opener that swallows the file');

  // A list-nested fence closes at the item's content indentation. Bounding the closer to three
  // absolute spaces means a wide marker never closes, and the fence eats the rest of the document.
  assert.deepEqual(documentSections('10. ```md\n    ## Fenced\n    ```\n## After'), ['After'],
    'a wide ordered-list marker still closes its fence');
  assert.deepEqual(documentSections('- ```md\n  ## Fenced\n  ```\n## After'), ['After'],
    'and so does a bullet marker');

  // Over-wide padding after a list marker is indented code under CommonMark, not a fence opener.
  // Opening one there would suppress every heading that follows it.
  assert.deepEqual(documentSections('-        ```literal\n## After'), ['After'],
    'more than four spaces after a list marker is code, not a fence');

  // …and the closer needs a MINIMUM too. A column-zero backtick run has left the list container:
  // it is not the nested fence's closer, and Markdown reads what follows as still fenced.
  assert.deepEqual(documentSections('10. ```md\n    ## Fenced\n```\n## Also Fenced'), [],
    'an unindented run does not close a list-nested fence');

  // Tab-expanded indentation counts as columns, not bytes.
  assert.deepEqual(documentSections('- \t```md\n\t## Fenced\n\t```\n## After'), ['After'],
    'a tab-indented nested fence opens and closes on column arithmetic');

  // CRLF. Every trailing-anchored pattern in the parser dies on a stray \r, and the failure mode
  // is silent: no heading matches, so every existence assertion fails for an unrelated reason.
  assert.deepEqual(documentSections('# Doc\r\n## One\r\n```\r\n## Fenced\r\n```\r\n## Two\r\n'), ['One', 'Two'],
    'a CRLF document parses identically to an LF one');

  // An HTML comment may open anywhere on a line, not only at column 0 — a trailing `<!--` leaves
  // the rest of the document looking live while a reader sees nothing.
  assert.deepEqual(documentSections('## One\ntrailing opener <!--\n## Hidden\n-->\n## Two'), ['One', 'Two'],
    'a mid-line comment opener still opens a comment');
  assert.deepEqual(documentSections('## One\nWrite `<!--` to open one.\n## Two'), ['One', 'Two'],
    'but a comment delimiter inside a code span is prose, and must not black out the document');
  assert.deepEqual(documentSections('## One\nUse ``<!--`` literally.\n## Two'), ['One', 'Two'],
    'a multi-backtick code span is a code span too — CommonMark delimits by equal-length runs');
  assert.deepEqual(documentSections('## One\nEscaped \\<!-- stays literal.\n## Two'), ['One', 'Two'],
    'and a backslash-escaped delimiter is not a delimiter');
});

test('liveText when masking → hides what a reader cannot see without inventing new matches', () => {
  const doc = 'Anchor stated\n<!--\n' + 'x'.repeat(200) + '\n-->\nnot overridable';
  const masked = liveText(doc);
  assert.doesNotMatch(masked, /x{10}/, 'hidden text cannot satisfy an assertion');

  // Masking must preserve length, not blank the line. Blanking shortens the document, so a bounded
  // pattern can match across a gap that was too wide before the text was hidden — swapping a false
  // negative for a false positive, which is the worse of the two for a contract test.
  assert.equal(masked.length, doc.length, 'the document keeps its length, so offsets are unchanged');
  assert.equal(/Anchor stated[\s\S]{0,80}not overridable/.test(masked),
    /Anchor stated[\s\S]{0,80}not overridable/.test(doc),
    'a bounded gap pattern behaves identically before and after masking');

  // Nor may the mask read as whitespace, or a `\s+` bridge spans content that used to separate.
  assert.equal(/Anchor stated\s+not overridable/.test(masked), false,
    'the mask is not whitespace');

  // fencesCount keeps a documented code block visible — a JSON mapping in a spec is something a
  // reader reads, and blanking it would force the spec to duplicate its own example in prose.
  const withFence = '```json\n{"a": 1}\n```';
  assert.doesNotMatch(liveText(withFence), /"a": 1/, 'by default a fence is an example, not evidence');
  assert.match(liveText(withFence, { fencesCount: true }), /"a": 1/, 'and opt-in makes it evidence');
});

test('liveText when constructs nest → document order decides, not construct type', () => {
  // The regression that made this a class rather than a case: resolving fences before comments
  // let a fenced block inside `<!-- … -->` read as visible documentation under fencesCount, so
  // commenting out the tech spec's own mapping example left its assertion green.
  const buried = '<!--\n```json\n{"testing.md": "testing-project.md"}\n```\n-->\ntail';
  assert.doesNotMatch(liveText(buried, { fencesCount: true }), /testing-project/,
    'a fence inside a comment is comment text — fencesCount does not resurrect it');
  assert.match(liveText(buried, { fencesCount: true }), /tail/, 'and the comment still ends');
  // …and the mirror case, which must keep working: comment syntax inside a fence is inert, or a
  // spec documenting an unterminated `<!--` token blacks out everything after it.
  const documented = '```\n<!-- unterminated\n```\nstill visible';
  assert.match(liveText(documented, { fencesCount: true }), /still visible/,
    'a comment opener inside a fence is example text, not a real opener');
});

test('liveText when a code span is malformed → backticks are literal and the comment is real', () => {
  const bt = '`';
  // CommonMark closes a span with a run of EXACTLY equal length. Treating any later backtick as a
  // closer made `` `<!--`` `` look like a span, leaving the heading after it "live".
  assert.deepEqual(documentSections(`${bt}<!--${bt}${bt}\n## Hidden`), [],
    'an unequal closing run does not open a span, so the <!-- really opens a comment');
  assert.deepEqual(documentSections(`\\${bt}<!--${bt}${bt}\n## Hidden`), [],
    'an escaped opening backtick is literal text, not a span delimiter');
  // The opposite error is just as bad: a valid span must stay visible, including one that spans
  // lines inside a paragraph, or documenting the token blacks out the prose around it.
  assert.match(liveText(`Use ${bt}<!--${bt} here.`), /<!--/, 'a well-formed span stays visible');

  // Multiline spans are deliberately NOT supported. CommonMark parses blocks before inlines, so a
  // fence or comment on a later line interrupts the paragraph and the span never reaches it;
  // letting the inline scanner run ahead instead let a span swallow a fenced block and expose the
  // headings inside. An unclosed run is literal text, which at worst opens a comment that is not
  // really there — over-hiding, the direction a guard is allowed to be wrong in.
  assert.doesNotMatch(liveText(`${bt}<!--\nstill code${bt}\nafter`), /after/,
    'an unclosed run falls to over-hiding rather than skipping a later block');
  assert.deepEqual(documentSections(`Text ${bt}code\n<!--\n## Hidden\n-->\nclosing ${bt}\n## After`),
    ['After'], 'a comment block interrupts the paragraph; the span cannot pair across it');
  assert.deepEqual(documentSections(`Text ${bt.repeat(3)}code\n${bt.repeat(3)}markdown\n## Hidden\n${bt.repeat(3)}\n${bt.repeat(3)}`),
    [], 'nor across a fenced block');
});

test('liveText when a block is indented or list-nested → renderer-invisible prose is masked', () => {
  const f = '`'.repeat(3);

  // Four columns in, a renderer emits <pre><code>. Nothing masked this, so moving a normative
  // paragraph right by four spaces turned it into an example while every assertion stayed green.
  const shifted = 'Intro.\n\n    Anchor-first resolution wording\n\nTail.';
  assert.doesNotMatch(liveText(shifted), /Anchor-first/, 'an indented block is code, not a rule');
  assert.match(liveText(shifted), /Tail\./, 'and the block ends where the indentation does');

  // …but indented code cannot interrupt a paragraph, or every deeply-wrapped continuation line
  // in the rule files would vanish and take real assertions with it.
  const wrapped = 'A normative sentence that\n    wraps with deep indent\nand continues.';
  assert.match(liveText(wrapped), /wraps with deep indent/, 'a wrapped continuation is prose');

  // A fence opened on a list CONTINUATION line has no marker on its own line. Recording it as
  // top-level let an unindented run close it, so everything after read as normative prose while a
  // renderer still had it inside the code block.
  const continuation = `- item\n  ${f}md\n  code\n${f}\nAnchor-first`;
  assert.doesNotMatch(liveText(continuation), /Anchor-first/,
    'a run at a shallower column does not close a fence opened deeper');
});

test('liveText when prose hides in a non-rendering block → masked like a fence', () => {
  const f = '`'.repeat(3);

  // A fence closer sits at EXACTLY its opener's column. A window keyed to the opener was wrong at
  // the deep end too: a 3-space opener accepted a 4-space closer, which CommonMark never does, so
  // everything after it read as normative prose while the renderer kept it inside the code block.
  assert.doesNotMatch(liveText(`   ${f}md\n   code\n    ${f}\nAnchor-first`), /Anchor-first/,
    'an over-indented run does not close a fence');

  // "Cannot interrupt a paragraph" needs to know what opens one. Headings, comments, list markers
  // and thematic breaks are non-blank without opening a paragraph, so reading the rule as "the
  // previous line was non-blank" left indented code exposed right after every heading.
  for (const [what, before] of [
    ['a heading', '## Override Contract'],
    ['a comment', '<!-- note -->'],
    ['a list marker', '- item'],
    ['a thematic break', '---'],
  ]) {
    assert.doesNotMatch(liveText(`${before}\n    Anchor-first wording`), /Anchor-first/,
      `indented code is still code after ${what}`);
  }

  // Non-comment HTML blocks and link reference definitions render as nothing a reader can act on,
  // so they are the same carrier failure as an HTML comment. HTML blocks ignore fencesCount: that
  // flag opts into fenced code *examples*, and the tech spec — which passes it — would otherwise
  // stay open to exactly this.
  for (const opts of [{}, { fencesCount: true }]) {
    assert.doesNotMatch(liveText('<script type="text/plain">\nAnchor-first\n</script>', opts),
      /Anchor-first/, 'a script block renders as nothing');
    assert.doesNotMatch(liveText('<div>\nAnchor-first\n</div>', opts), /Anchor-first/,
      'so does any other HTML block');
  }
  assert.doesNotMatch(liveText('[Anchor-first]: /unused'), /Anchor-first/,
    'a link reference definition produces no output');
  // …while inline HTML inside a paragraph is ordinary rendered prose.
  assert.match(liveText('Use <b>bold</b> Anchor-first here.'), /Anchor-first/,
    'inline HTML is not a block');
});

test('guarded documents when validated → stay inside the structure the scanner models', () => {
  // The gate this file's conclusions rest on. Eighteen review rounds each found another Markdown
  // construct that hid normative prose from a reader while every assertion here stayed green;
  // each fix modelled one more construct and several introduced interactions with the last.
  //
  // Modelling more is the losing side of that trade. This asserts the other one: a document whose
  // prose is pinned here must stay inside the structure the scanner actually models, and a
  // construct outside it fails HERE, naming the file and line, instead of being silently
  // mis-masked into a false pass. Adding such a construct to a rule file is now a test failure
  // with an instruction, which is the outcome every one of those rounds should have produced.
  for (const [name, doc] of [
    ['rules/auto-loop.md', autoLoop],
    ['rules/testing.md', testing],
    ['rules/auto-loop-project.md', autoLoopTpl],
    ['rules/testing-project.md', testingTpl],
    ['rules/discretion.md', readFileSync(resolve(root, 'rules/discretion.md'), 'utf8')],
    ['docs/features/rule-override-pattern/2-tech-spec.md', specRaw],
    ['skills/install-rules/SKILL.md', readFileSync(resolve(root, 'skills/install-rules/SKILL.md'), 'utf8')],
  ]) {
    assert.deepEqual(structuralViolations(doc), [],
      `${name} uses a structure the visibility scanner does not model`);
  }
});

test('the structural gate when probed → rejects every carrier six review rounds found', () => {
  // Each entry hid normative wording from a renderer while the tests stayed green in some round.
  // The gate does not need to mask them correctly — it needs to refuse the document.
  const f = '`'.repeat(3);
  const cases = [
    ['setext H2 underline', 'Resolution is Anchor-first\n---\n'],
    ['setext H1 underline', 'Resolution is Anchor-first\n===\n'],
    ['raw HTML block', '<script type="text/plain">\nAnchor-first\n</script>\n'],
    ['link reference definition', '[Anchor-first]: /unused\n'],
    ['setext heading mid-document', 'Intro\n\nAnchor-first\n-\n'],
    ['list-nested HTML', '- item\n\n    <script>\n    Anchor-first\n    </script>\n'],
    ['multiline link reference', '[Anchor-first]:\n  /unused\n'],
    ['indented code block', 'Intro.\n\n    Anchor-first\n'],
    ['indented fence opener', '   ' + f + 'md\n   Anchor-first\n   ' + f + '\n'],
  ];
  for (const [what, doc] of cases) {
    assert.notDeepEqual(structuralViolations(doc), [], `the gate must reject ${what}`);
  }
  // …and must not fire on the ordinary prose the rule files are made of.
  const ordinary = [
    '## Heading\n\nA sentence that\nwraps normally.\n',
    '| a | b |\n|---|---|\n| 1 | 2 |\n',
    '- item\n- item\n\n1. one\n2. two\n',
    '<!-- Generated by: /install-rules -->\n\n## Tier\n',
    'Text with `code` and <https://example.com> inline.\n',
    f + 'json\n{"a": 1}\n' + f + '\n',
    '---\nname: x\n---\n\n# Title\n',
  ];
  for (const doc of ordinary) {
    assert.deepEqual(structuralViolations(doc), [], `the gate must accept: ${JSON.stringify(doc)}`);
  }
});

test('the structural gate when the scanner is blind → catches what masking gets wrong', () => {
  // The division of labour, asserted rather than assumed. These two constructs ARE still masked
  // wrongly — a setext underline mid-document leaves the indented code after it exposed, and
  // list-nested HTML stays visible under fencesCount. Nineteen rounds say chasing them would just
  // add another ordering interaction.
  //
  // So the scanner makes no promise about them, and the gate refuses the document instead. What
  // must never happen is BOTH being permissive: a construct the scanner mis-masks and the gate
  // accepts is a silent false pass, which is the defect this whole file exists to prevent.
  for (const [what, doc] of [
    ['a setext heading mid-document', 'Intro\n\nSubheading\n-\n    Anchor-first'],
    ['list-nested HTML', '- item\n\n    <script type="text/plain">\n    Anchor-first\n    </script>'],
  ]) {
    assert.ok(liveText(doc, { fencesCount: true }).includes('Anchor-first'),
      `fixture premise: the scanner still mis-masks ${what}`);
    assert.notDeepEqual(structuralViolations(doc), [],
      `${what} is mis-masked, so the gate must refuse the document`);
  }
});

/** The two parent override sections, as normalized live text — prose and table rows alike.
 *
 *  Table rows are pinned too, and excluding them was a real hole: `parseMappingTable()` consumes
 *  every row structurally, but its Kind cell only has to start with one of three words and most
 *  Tier cells only have to start with `Default`, so `| Default — Anchor instructions may be
 *  overridden |` satisfied every structural assertion while reversing the contract. Structural
 *  closure over a row is not semantic closure over its text.
 *
 *  This is the other half of the gate. `structuralViolations()` asks whether prose is carried in a
 *  structure a reader actually sees; it cannot ask whether the prose still says what it said. A
 *  perfectly visible edit — dropping the "never overridable" clause, hedging "Anchor wins" into
 *  "Anchor usually wins", inserting a sentence that grants an exception — passes every guard in
 *  this file, because each one matches a pattern the sentence still contains. Equality is the only
 *  assertion that fails on deletion, hedging, inversion, and contradictory addition alike. */
const CANONICAL_AUTO_LOOP_OVERRIDE =
  '`rules/auto-loop-project.md` (user-owned) customizes this file — **Default and Guidance tiers ' +
  'only**. Anchor-tier instructions (`rules/discretion.md` § Anchor Register) are never ' +
  'overridable: on conflict the Anchor wins and the conflict is reported, not silently resolved. ' +
  'Resolution is **Anchor-first**, because an instruction\'s tier is decided by `discretion.md`, ' +
  'never by a label written next to it: **(0)** an Anchor Register hit resolves to **Anchor** and ' +
  'stops there — a tier annotation in either file cannot downgrade a Register hit, and one that ' +
  'tries is reported as a conflict rather than honoured. Only for non-Anchor instructions does the ' +
  'rest apply, highest first: (1) an explicit tier annotation on the instruction itself; (2) the ' +
  'heading table below; (3) preamble text before the first `##` resolves as one synthetic section; ' +
  '(4) an unknown heading fails closed to **Default** and is listed in the report, never silently ' +
  'dropped. Two override kinds, and the distinction is load-bearing: a **section replacement** ' +
  'restates a `##` heading this file actually defines and replaces that section wholesale; a ' +
  '**setting** names a configuration slot that this file\'s prose or a hook reads by name. Settings ' +
  'have no same-named section here, so "full replacement" never describes them — the shipped ' +
  'scaffold is settings-only, and every one names its consumer below. | Override heading | Kind — ' +
  'consumed by | Tier | |------------------|--------------------|------| | preamble (synthetic ' +
  'section) | Header — the live precedence declaration, resolved as one synthetic section | ' +
  'Default | | `## Tier` | Setting — § Tiers, "the configured tier … baseline, not a ceiling" | ' +
  'Default — the security/data-integrity escalation sentence in § Tiers is Anchor-tier (Anchor ' +
  'Register #3 hit, resolved at step 0) and stays binding whatever tier is configured | | `## Max ' +
  'Rounds` | Setting — § Tiers cap sentence; the model tracks rounds against it | Default | | `## ' +
  'Plan Review` | Setting — `/plan-review` self-invocation in plan mode | Default | | `## Plan ' +
  'Review Max Rounds` | Setting — `/plan-review` loop bookkeeping, counted in conversation | ' +
  'Default | | `## Git Memory` | Setting — post-compact git-context nudge (printed by default ' +
  'since hook-lightweighting; heading kept for compatibility) | Default | | `## Think Harder` | ' +
  'Setting — the diagnosis protocol after a compaction, read by the model (no hook injects ' +
  'it); § Stall Detection and Diagnosis routes to `loop-diagnostics.md` § Cap Diagnostic ' +
  'Protocol, which carries the checklist ' +
  '| Default | | `## Review Thread Rotation` | Setting — the R-a rotation threshold (2–6, unset = ' +
  '3) read behaviourally by `review-common.md` § Review Loop; counted in conversation, no hook ' +
  'reads it | Default | No row is a section replacement: `## Tier` is deliberately **not** this ' +
  'file\'s `## Tiers`, and the other six name no section at all. A user who does want a section replacement ' +
  'restates that section\'s exact heading — the mechanism is available, the scaffold just does not ' +
  'ship one.';

const CANONICAL_TESTING_CUSTOMIZATION =
  'Project-specific overrides belong in `testing-project.md` (not this file). See ' +
  '`@rules/testing-project.md` for your project\'s custom testing conventions. Override contract: an ' +
  'active `##` section there customizes this file — **Default and Guidance tiers only**. ' +
  'Anchor-tier rows (the security / data-integrity / regression "❌ Never" rows, per ' +
  '`rules/discretion.md` § Anchor Register) are never overridable: on conflict the Anchor wins and ' +
  'the conflict is reported. Resolution is **Anchor-first**, since tier is decided by ' +
  '`discretion.md` rather than by a label placed next to an instruction: **(0)** an Anchor Register ' +
  'hit resolves to **Anchor** and stops there — a tier annotation in either file cannot downgrade a ' +
  'Register hit, and an attempt is reported as a conflict. Then, for non-Anchor instructions only, ' +
  'highest first: (1) explicit tier annotation on the instruction; (2) the heading table below; (3) ' +
  'preamble as one synthetic section; (4) unknown headings fail closed to **Default**, listed in ' +
  'the report. Kinds, as in `auto-loop.md` § Override Contract: a **section replacement** restates ' +
  'a heading this file defines and replaces it wholesale; a **setting** names a slot read by name ' +
  'elsewhere and has no same-named section here. | Override heading | Kind — consumed by | Tier | ' +
  '|------------------|--------------------|------| | preamble (synthetic section) | Header — the ' +
  'live precedence declaration, resolved as one synthetic section | Default | | `## Test Pyramid` | ' +
  'Section replacement — this file\'s `## Test Pyramid` | Default | | `## Adequacy Mode ' +
  '(project-only extension — not in testing.md core)` | Setting — `auto-loop.md` § Tiers gate ' +
  'sequence reads the Adequacy Gate mode from it | Default — project-only extension with no parent ' +
  'section here; permitted as a documented extension, resolved by this table (exact template ' +
  'heading) rather than parent-heading match |';

/** Section prose, normalized for comparison. NUL is dropped rather than kept: it marks text the
 *  scanner hid, which by definition is not prose a reader receives — and the gate above is what
 *  keeps normative wording from being hidden there in the first place. */
function normalizeSection(sectionText) {
  return sectionText
    .split(String.fromCharCode(0))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

test('the parent override sections when reworded → still say what the templates rely on', () => {
  for (const [what, doc, heading, canonical] of [
    ['rules/auto-loop.md § Override Contract', autoLoop, 'Override Contract',
      CANONICAL_AUTO_LOOP_OVERRIDE],
    ['rules/testing.md § Project Customization', testing, 'Project Customization',
      CANONICAL_TESTING_CUSTOMIZATION],
  ]) {
    assert.equal(normalizeSection(section(doc, heading)), canonical,
      `${what} changed — read the diff, confirm it is not a deletion, a hedge, or an inversion of Anchor supremacy, then update the pinned value in the same commit`);
  }
});

test('the section pin rejects the edits every pattern guard accepts', () => {
  // Each mutation leaves the section perfectly visible and keeps the words the other assertions
  // look for. Only equality notices.
  const mutations = [
    ['deletion', (s) => s.replace(' and the conflict is reported, not silently resolved.', '.')],
    ['hedge', (s) => s.replace('the Anchor wins', 'the Anchor usually wins')],
    ['inversion', (s) => s.replace('are never overridable', 'are overridable')],
    ['contradictory addition',
      (s) => s.replace('## Override Contract\n', '## Override Contract\n\nA project may waive any of the below.\n')],
  ];
  for (const [what, mutate] of mutations) {
    const mutated = mutate(autoLoop);
    assert.notEqual(mutated, autoLoop, `fixture premise: the ${what} mutation applied`);
    assert.notEqual(normalizeSection(section(mutated, 'Override Contract')),
      CANONICAL_AUTO_LOOP_OVERRIDE, `the pin must reject a ${what}`);
  }
});

test('the structural gate when a carrier hides behind a container → still judges the line', () => {
  // Round 19 found the gate's four holes were all one mistake: judging the raw line. A blockquote
  // prefix, an indent, or a mid-line position put every predicate out of reach while the construct
  // kept working on the reader exactly as before.
  const f = '`'.repeat(3);
  for (const [what, doc, why] of [
    ['blockquoted setext', '> Resolution is Anchor-first\n> ---\n', /setext/],
    ['blockquoted indented code', '> Intro.\n>\n>     Anchor-first\n', /indented code/],
    ['mid-line raw-text element', 'Carrier: <script>Anchor-first</script>\n', /raw HTML/],
  ]) {
    assert.ok(liveText(doc, { fencesCount: true }).split(' ').join('').includes('Anchor-first'),
      `fixture premise: ${what} still reaches a caller reading the document`);
    assert.match(structuralViolations(doc).join('\n'), why, `the gate must reject ${what}`);
  }

  // The fourth hole is the one that matters most, because it is the two-permissive condition the
  // gate exists to exclude. `scan()` demands a closer at the opener's exact column, so a fence
  // closed one space in keeps swallowing; a gate that reused those regions would skip the same
  // lines and judge nothing. The biases are therefore opposite — `gateFencedLines` closes as early
  // as any renderer might — and a line escapes only when both agree it is inert.
  const early = f + '\ncode\n ' + f + '\n<div>\nAnchor-first\n</div>\n';
  assert.ok(!liveText(early).split(' ').join('').includes('Anchor-first'),
    'fixture premise: the scanner still treats the fence as open past the indented closer');
  assert.match(structuralViolations(early).join('\n'), /raw HTML|ambiguous/,
    'the gate must judge lines the scanner is still swallowing');
});

test('front matter when read as prose → is evidence to neither the scanner nor the gate', () => {
  // The same text may not be "not prose" to the gate and "normative wording" to a caller: that
  // split is how a rule sentence gets pinned by a test while rendering as a metadata field. Both
  // sides now treat front matter as structured prelude, whatever `fencesCount` says.
  const doc = '---\nnote: Anchor-first\n---\n\n# Title\n\nBody.\n';
  assert.ok(!liveText(doc, { fencesCount: true }).includes('Anchor-first'),
    'front matter must not be readable as document prose');
  assert.deepEqual(structuralViolations(doc), [], 'and the gate must not judge it either');
  assert.ok(liveText(doc).includes('Body.'), 'while the body after it stays visible');
});

test('the gate fence pass when an inert fence opens it → does not swallow the rest of the file', () => {
  // Round 20's discovery, and the sharpest form of the two-permissive failure so far. The gate's
  // fence pass had the right bias — close early — but no state: a `~~~` that no renderer ever
  // treats as a fence still put it into a fenced region that ran to the end of the document, and
  // every carrier after it was skipped without being judged. Bias is not enough; the pass has to
  // know when a fence is inert and when its container has ended.
  const t = '~'.repeat(3);
  const carrier = 'Carrier: <script type="text/plain">Anchor-first</script>\n';
  for (const [what, doc] of [
    ['a fence whose blockquote ended', '> ' + t + '\n> example\n' + carrier],
    ['a fence inside an HTML comment', '<!--\n' + t + '\n-->\n' + carrier],
    ['a fence inside YAML front matter', '---\nexample: |\n  ' + t + '\n---\n' + carrier],
  ]) {
    assert.ok(liveText(doc, { fencesCount: true }).includes('Anchor-first'),
      `fixture premise: ${what} leaves the carrier readable`);
    assert.match(structuralViolations(doc).join('\n'), /raw HTML/,
      `${what} must not put the gate into a fenced state that skips the carrier`);
  }
});

test('the gate when the carrier is an unenumerated tag → rejects raw HTML outright', () => {
  // Two denylists — raw-text elements and block-level tags — were the same losing trade as a
  // scanner that models one more construct per round: `<script>` hides its content, and so do
  // `<template>` and `<span hidden>`, and so will the next attribute nobody listed. The subset is
  // closed instead: no raw HTML anywhere, with exactly two carve-outs.
  for (const doc of [
    'Carrier: <template>Anchor-first</template>\n',
    'Carrier: <span hidden>Anchor-first</span>\n',
    'Carrier: <div style="display:none">Anchor-first</div>\n',
  ]) {
    assert.ok(liveText(doc, { fencesCount: true }).includes('Anchor-first'),
      'fixture premise: the scanner leaves the carrier readable');
    assert.match(structuralViolations(doc).join('\n'), /raw HTML/,
      `the gate must reject: ${doc.trim()}`);
  }

  // …and the carve-outs, plus the metasyntax the rule files are actually made of. Every raw angle
  // bracket in the guarded documents is a placeholder inside a code span, so stripping spans first
  // is what makes a rule this strict usable at all.
  const f = '`'.repeat(3);
  for (const doc of [
    '<!-- Generated by: /install-rules -->\n\n## Tier\n',
    f + 'html\n<div>example</div>\n' + f + '\n',
    'Run `/codex-test-review --ac-trace <request-path>` first.\n',
    'Log `[NIT_DEFERRED] file:line | issue | reason: sub-threshold-<severity>`.\n',
    'See <https://example.com> or mail <someone@example.com>.\n',
  ]) {
    assert.deepEqual(structuralViolations(doc), [], `the gate must accept: ${doc.trim()}`);
  }
});

test('the mapping table when a cell contradicts the contract → fails the section pin', () => {
  // `parseMappingTable()` consumes every row, which is structural closure, not semantic closure:
  // a Kind cell need only start with one of three words and most Tier cells need only start with
  // `Default`. Excluding table rows from the pin therefore left the rows open to exactly the edit
  // the pin exists to catch — a visible sentence that reverses what the section promises.
  const mutated = autoLoop.replace(
    '| `## Max Rounds` | Setting — § Tiers cap sentence; the model tracks rounds against it | Default |',
    '| `## Max Rounds` | Setting — § Tiers cap sentence; the model tracks rounds against it | Default — Anchor instructions may be overridden |'
  );
  assert.notEqual(mutated, autoLoop, 'fixture premise: the contradictory cell was inserted');
  assert.notEqual(normalizeSection(section(mutated, 'Override Contract')),
    CANONICAL_AUTO_LOOP_OVERRIDE, 'the pin must reject a contradiction written into a table cell');
});

test('the gate fence pass when a list holds the fence → accepts the closer the renderer accepts', () => {
  // Blockquote depth was tracked; list-content indentation was not, so a fence opened at `-    ~~~`
  // could only be closed by a run at columns 0–3 that a real document never writes. The fence
  // stayed open and every carrier after it was skipped. The bias settles it: mistaking indented
  // content for a closer is a loud false rejection, refusing a real closer is a silent false pass,
  // so a closer at the opener's blockquote depth may be indented arbitrarily.
  const t = '~'.repeat(3);
  const carrier = 'Carrier: <script type="text/plain">Anchor-first</script>\n';
  for (const [what, doc] of [
    ['a bullet-list fence', '-    ' + t + '\n     example\n     ' + t + '\n' + carrier],
    ['an ordered-list fence', '10. ' + t + '\n    example\n    ' + t + '\n' + carrier],
  ]) {
    assert.ok(liveText(doc, { fencesCount: true }).includes('Anchor-first'),
      `fixture premise: ${what} leaves the carrier readable`);
    assert.match(structuralViolations(doc).join('\n'), /raw HTML/,
      `${what} closes, so the gate must judge what follows it`);
  }
});

test('the gate when `<` hides outside a named tag → judges the bracket, not the tag name', () => {
  // The third and final inversion of this rule. Enumerating raw-text elements failed; enumerating
  // every named tag failed too, because CommonMark's raw HTML also includes processing
  // instructions, declarations and CDATA — none of which has a tag name — and because a tag whose
  // `<span` ends one line and whose `hidden>` opens the next matches no single-line pattern. The
  // angle bracket itself is now the violation, and the carve-outs are named rather than the
  // violations enumerated.
  const bt = '`';
  for (const [what, doc] of [
    ['a processing instruction', '<?instruction Anchor-first?>\n'],
    ['a declaration', '<!DOCTYPE Anchor-first>\n'],
    ['a CDATA section', '<![CDATA[Anchor-first]]>\n'],
    ['a tag split across lines', 'Carrier: <span\n hidden>Anchor-first\n'],
    ['a span opened by an escaped backtick',
      'Carrier: \\' + bt + ' <script type="text/plain">Anchor-first</script> ' + bt + '\n'],
  ]) {
    assert.ok(liveText(doc, { fencesCount: true }).includes('Anchor-first'),
      `fixture premise: ${what} leaves the carrier readable`);
    assert.match(structuralViolations(doc).join('\n'), /raw HTML/, `the gate must reject ${what}`);
  }

  // The carve-outs, and the two forms that are not markup at all. An escaped `\<` is a literal
  // character a reader sees; a `<` inside a code span is metasyntax, which is why the stripper runs
  // first — and why it has to use the same escape-aware run finder the scanner does.
  for (const doc of [
    'See <https://example.com> and <a@b.co>.\n',
    'Write \\<script\\> to show a tag.\n',
    'Run ' + bt + '--ac-trace <request-path>' + bt + ' first.\n',
    '~~~html\n<div>x</div>\n~~~\n',
  ]) {
    assert.deepEqual(structuralViolations(doc), [], `the gate must accept: ${doc.trim()}`);
  }
});

test('the two fence passes when they disagree → judge the line instead of skipping it', () => {
  // The invariant this file's header states, finally enforced rather than described. Running on
  // the gate's pass alone, its early-close bias could not merely mis-close once: the literal `~~~`
  // that follows an early close is content to the renderer but an OPENER to the gate, and the real
  // closer does not close a tilde fence. One accepted-too-soon closer therefore swallowed the rest
  // of the document. Intersecting the two passes turns every disagreement into judgement.
  const b = '`'.repeat(3);
  const t = '~'.repeat(3);
  const doc = b + 'md\n    ' + b + '\n' + t + '\n' + b + '\n'
    + 'Carrier: <script type="text/plain">Anchor-first</script>\n';
  assert.ok(liveText(doc, { fencesCount: true }).includes('Anchor-first'),
    'fixture premise: the carrier is outside the real fence and reaches a caller');
  assert.match(structuralViolations(doc).join('\n'), /raw HTML|ambiguous/,
    'the gate must not let fence re-entry skip a live carrier');
});

test('the gate when the carrier is a link destination → rejects inline links and images', () => {
  // A carrier with no `<` in it, so the angle-bracket rule cannot see it. A rendered reader sees
  // "health check"; `liveText()` hands the caller the destination, the title, and an image's alt
  // text as well. Masking those instead would restart the parser-expansion cycle round 18 ended,
  // so the closed subset excludes the construct: write the path as text or as an autolink.
  for (const [what, doc] of [
    ['a link destination', 'Visible [health check](https://example.invalid/Anchor-first).\n'],
    ['a link title', 'Visible [health check](https://example.invalid "Anchor-first").\n'],
    ['an image alt', '![Anchor-first](missing.png)\n'],
  ]) {
    assert.ok(liveText(doc, { fencesCount: true }).includes('Anchor-first'),
      `fixture premise: ${what} reaches a caller reading the document`);
    assert.match(structuralViolations(doc).join('\n'), /inline link or image/,
      `the gate must reject ${what}`);
  }

  // The forms that replace it, and the bracket syntax the rule files are full of.
  for (const doc of [
    'See <https://example.com/x> for detail.\n',
    'Detail: `docs/features/x/4-implementation.md`.\n',
    '- [ ] item\n- [x] done\n',
    'Log `[NIT_DEFERRED] file:line | issue` and proceed.\n',
  ]) {
    assert.deepEqual(structuralViolations(doc), [], `the gate must accept: ${doc.trim()}`);
  }
});

test('the link rule when the label is not flat → judges the join, not the label', () => {
  // `\[[^\]]*\]\(` was an enumeration wearing a regex: it described one shape of label and missed
  // `[visible [nested]](dest)` and a label wrapped across two lines. The label is the part an
  // author controls freely, so the check moved to the two characters that join ANY label to ANY
  // destination — which an inline link cannot avoid.
  for (const [what, doc] of [
    ['a nested-bracket label', '[visible [nested]](https://example.invalid/Anchor-first)\n'],
    ['a label split across lines', '[visible\nlabel](https://example.invalid/Anchor-first)\n'],
  ]) {
    assert.ok(liveText(doc, { fencesCount: true }).includes('Anchor-first'),
      `fixture premise: ${what} still hands the destination to a caller`);
    assert.match(structuralViolations(doc).join('\n'), /inline link or image/,
      `the gate must reject ${what}`);
  }
});

test('the gate when a comment ends mid-line → judges the live suffix, not the whole row', () => {
  // `commented[i]` was a per-line verdict on a construct that ends mid-line: everything after
  // `-->` renders, and the row carrying it was skipped whole. The gate now blanks commented
  // COLUMNS, so a fully commented row still drops out while a live suffix stays judgeable.
  const doc = '<!-- open\n--><script type="text/plain">Anchor-first</script>\n';
  assert.ok(liveText(doc, { fencesCount: true }).includes('Anchor-first'),
    'fixture premise: the suffix after the comment close reaches a caller');
  assert.match(structuralViolations(doc).join('\n'), /closes mid-line/,
    'the gate must judge what follows a mid-line comment close');

  // A comment BETWEEN prose is no longer accepted, and that tightening is deliberate: it splits a
  // line into judged and unjudged segments, which is precisely the surface on which two readings of
  // where a comment ends can disagree. No guarded document writes one.
  assert.match(structuralViolations('Text <!-- note --> more text.\n').join('\n'), /mid-line/,
    'an inline comment between prose is outside the subset');

  // The forms that must keep passing: a comment is still the subset's carve-out, and detection
  // runs over a code-span-stripped copy so metasyntax opens nothing — while the JUDGED text keeps
  // its spans, because blanking them would turn a leading `` `npm test` `` into indented code.
  const bt = '`';
  for (const ok of [
    '<!-- just a note -->\n\n## Tier\n',
    '<!--\n## Plan Review\n-->\n\n## Tier\n',
    'The marker ' + bt + '<!--' + bt + ' opens a comment.\n',
    bt + 'npm test' + bt + ' runs the suite.\n',
  ]) {
    assert.deepEqual(structuralViolations(ok), [], `the gate must accept: ${JSON.stringify(ok)}`);
  }
});

test('comments in a guarded document → are a constrained subset, not a second parser', () => {
  // Rounds 23 and 24 were the same failure arriving twice: a cross-line comment state machine in
  // the gate must agree with the scanner's, and every place two parsers can disagree about where a
  // comment starts or ends is a false green. `<!-->` advances one four columns and the other zero;
  // a `<!--` in front matter or in a fence region the two passes classify differently opens a
  // comment in one reading and not the other.
  //
  // So the gate stopped parsing comments. A guarded document may write one only in a shape where
  // the two readings cannot diverge, and every other shape is reported — the loud direction. This
  // is round 18's trade (a smaller input beats a bigger parser) applied to the construct that kept
  // producing the disagreements.
  const b = '`'.repeat(3);
  const link = '[visible [nested]](https://example.invalid/Anchor-first)\n';
  for (const [what, doc, why] of [
    ['an overlapping delimiter', '<!-->\n' + link, /malformed comment delimiter/],
    ['a longer overlapping delimiter', '<!--->\n' + link, /malformed comment delimiter/],
    ['an opener inside front matter', '---\nnote: <!--\n---\n' + link, /inline link or image/],
    ['an opener in a disputed fence region', b + 'md\n    ' + b + '\n<!--\n' + b + '\n' + link,
      /never closed|ambiguous/],
    ['a comment that never closes', '<!-- open\nstill open\n', /never closed/],
    ['a close with no opener', 'text\n-->\n', /close with no opener/],
    ['an opener after live text', 'live text <!-- hidden\n-->\n', /opens mid-line/],
  ]) {
    assert.match(structuralViolations(doc).join('\n'), why, `the gate must reject ${what}`);
  }

  // The shapes the shipped scaffolds actually use must keep passing: a whole-line comment, and a
  // block whose opener starts its line and whose closer ends one — including the wrapped form the
  // override templates ship, where prose runs from the opener line to the closer line.
  for (const ok of [
    '<!-- Generated by: /install-rules -->\n\n## Tier\n',
    '<!-- User-owned; the merge never touches it.\n     Uncomment to activate. -->\n\n## Tier\n',
    '<!--\n## Test Pyramid\n-->\n\n## Adequacy Mode\n',
  ]) {
    assert.deepEqual(structuralViolations(ok), [], `the gate must accept: ${JSON.stringify(ok)}`);
  }
});

test('the two fence passes when they disagree → the document is rejected, not resolved', () => {
  // Intersecting was right for the structural predicates but wrong as an input to anything with
  // cross-line state: on a disputed line the intersection says "not fenced", so a literal `<!--`
  // inside the scanner's fence opened a gate-only comment that blanked live text after it.
  // Deciding a disputed line either way is a guess, and a guess toward skipping is the false green
  // this whole file exists to prevent — so disagreement is itself outside the subset.
  const b = '`'.repeat(3);
  const doc = b + 'md\n    ' + b + '\n~~~\n' + b + '\nCarrier: <script>Anchor-first</script>\n';
  assert.match(structuralViolations(doc).join('\n'), /ambiguous/,
    'a line the two passes classify differently must be reported');
});

test('the comment subset when the shape is degenerate → rejects what two readings would split on', () => {
  // Round 25's three holes, all the same shape as every round before it: a comment whose extent
  // one reader computes differently from another. An overlapping `<!-->` closes for the scanner at
  // the overlap and, if a later `-->` existed, ran to that one here. A `> <!--` followed by an
  // unquoted line is one comment to a per-row prefix stripper and two blocks to CommonMark, which
  // ends the blockquote — and the HTML block inside it — at the unquoted line.
  const link = '[visible [nested]](https://example.invalid/Anchor-first)';
  for (const [what, doc, why] of [
    ['an overlapping opener with a later closer', '<!--> Visible ' + link + ' -->\n',
      /malformed comment delimiter/],
    ['a comment that outlives its blockquote', '> <!--\nSection-level full replacement.\n-->\n',
      /inside a blockquote/],
    ['a nested opener on an intermediate row', '<!--\ninner <!--\nstill comment\n-->\n',
      /nested comment opener/],
    // Depth zero was not enough: an INDENTED `<!--` opens an HTML block inside a list item or an
    // indented code block, and which rows belong to it then depends on container rules neither
    // reader models. Column zero is the shape both readings agree on.
    ['a comment indented into a list', '- item\n\n  <!--\nwithdrawn\n-->\n', /column zero/],
    ['a comment at code-block indentation', '    <!--\n    withdrawn\n    -->\n', /column zero/],
    // Inside a comment, Markdown inline syntax does not exist: a renderer closes at the first
    // `-->` whatever backticks surround it. Stripping code spans there invented comment state the
    // scanner never shared, and the gate skipped the rows it had invented it for.
    ['a code span around a comment closer', '<!-- `-->`\n    Anchor-first\n-->\n', /closes mid-line/],
  ]) {
    assert.match(structuralViolations(doc).join('\n'), why, `the gate must reject ${what}`);
  }

  // The three shapes the shipped scaffolds use, unchanged.
  for (const ok of [
    '<!-- Generated by: /install-rules -->\n\n## Tier\n',
    '<!-- User-owned; the merge never touches it.\n     Uncomment to activate. -->\n\n## Tier\n',
    '<!--\n## Test Pyramid\n-->\n\n## Adequacy Mode\n',
  ]) {
    assert.deepEqual(structuralViolations(ok), [], `the gate must accept: ${JSON.stringify(ok)}`);
  }
});

test('the carrier record when retracted rather than removed → fails the pin', () => {
  // The class the structural gate cannot see, because nothing about the document's structure is
  // wrong: the prose is visible, correctly formed, and struck through. A reader sees a retracted
  // finding; every regex asserting the finding still matches. Banning `~~` is not available —
  // this spec uses strikethrough legitimately to mark superseded design — so the answer is the
  // one that never enumerates: pin the text and let any wrapper change it.
  const raw = readFileSync(resolve(root, 'docs/features/rule-override-pattern/2-tech-spec.md'), 'utf8');
  const mutated = raw.replace('HTML 註解不進入模型 context', '~~HTML 註解不進入模型 context~~');
  assert.notEqual(mutated, raw, 'fixture premise: the strikethrough wrapper applied');

  const live = liveText(mutated, { fencesCount: true });
  assert.match(live, /HTML 註解不進入模型 context/,
    'fixture premise: every regex asserting the finding still matches the retracted form');
  assert.deepEqual(structuralViolations(mutated), [],
    'fixture premise: the structural gate sees nothing wrong — the document is well formed');

  const row = toLines(live).find((l) => l.startsWith('| Precedence mechanism |'));
  assert.notEqual(normalizeSection(row), CANONICAL_CARRIER_RECORD,
    'the pin must reject a finding that is retracted rather than removed');
});

test('masking when the document is exotic → never invents text and never changes length', () => {
  // The class-level guard behind every case above. Whatever construct the scanner fails to model,
  // the output must stay a character-wise subset of the input at identical offsets: masking may
  // hide too much (a loud test failure) but may never reveal, reorder, or shorten (a silent false
  // pass). Nine rounds of findings were all instances of breaking this one property.
  const bt = '`';
  const f = bt.repeat(3);
  const corpus = [
    `${f}md\ncode\n> ${f}\n## H`,          // false closer from another container
    `a ${bt}b\n<!--\nc\n-->\nd`,            // unclosed span meeting a comment block
    `> ${f}\n> x\n${f}`,                    // fence outliving its blockquote
    'A\r\n<!--\r\nx\r\n-->\r\nB',           // CRLF
    `${bt}<!--${bt}${bt}\n## H`,            // unequal backtick runs
    '\u{1F600} <!-- hidden --> tail',       // astral offsets
    '<!-- unterminated at EOF',             // no closing delimiter
    '--> orphan closer',                    // closer with no opener
    'p\n\n    indented code\n\np',          // indented code block
    `- item\n  ${f}md\n  code\n${f}\nafter`,  // list-continuation fence
    `> - x\n>   ${f}\n>   y\n> ${f}`,         // list inside a blockquote
    '<script>\nx\n</script>',               // HTML block with a closing tag
    '<div>\nx',                             // HTML block ended by EOF
    '[a]: /b\ntext',                        // link reference definition
    '## H\n    code\ntext',                 // indented code after a heading
  ];
  for (const doc of corpus) {
    for (const opts of [{}, { fencesCount: true }]) {
      const masked = liveText(doc, opts);
      assert.equal(masked.length, doc.length, `length drifted: ${JSON.stringify(doc)}`);
      for (let i = 0; i < doc.length; i += 1) {
        assert.ok(masked[i] === doc[i] || masked[i] === '\u0000',
          `masking invented a character at ${i} in ${JSON.stringify(doc)}`);
      }
    }
  }
});

test('liveText when the document uses containers or astral characters → masking still lands', () => {
  // A blockquoted fence is an example exactly as an unquoted one is; missing the container let
  // required wording be deleted from normative prose and kept only in a quoted example.
  assert.doesNotMatch(liveText('> ```markdown\n> Anchor-first\n> ```'), /Anchor-first/,
    'a fence inside a blockquote is still a fence');
  // The mask is indexed by UTF-16 code unit; rebuilding by code point shifted every index after an
  // astral character and exposed the text behind it.
  const emoji = `${'\u{1F600}'.repeat(5)} x <!-- REQUIRED --> tail`;
  const masked = liveText(emoji);
  assert.doesNotMatch(masked, /REQUIRED/, 'hidden text stays hidden after an astral character');
  assert.match(masked, /\u{1F600}{5}/u, 'and the astral characters survive intact');
  assert.equal(masked.length, emoji.length, 'length is preserved in code units');
});

// --- Live precedence header (carrier form) ---

test('section extraction when the parent contract is hidden → fails instead of validating dead text', () => {
  // Every hierarchy and mapping assertion in this file reads its text through section(). With a
  // raw indexOf that text is found whether or not a reader ever sees it, so wrapping
  // `## Override Contract` in a comment left the whole file green while the contract had been
  // stripped from model context — the exact carrier failure R8 exists to fix.
  const wrapped = autoLoop.replace('## Override Contract', '<!--\n## Override Contract');
  assert.throws(() => section(wrapped, 'Override Contract'), /live text/,
    'a commented-out parent section must fail extraction');
  const fenced = autoLoop.replace('## Override Contract', '```markdown\n## Override Contract');
  assert.throws(() => section(fenced, 'Override Contract'), /live text/,
    'a fenced parent section must fail extraction too');
  const duplicated = `${autoLoop}\n\n## Override Contract\n\nAnything at all.\n`;
  assert.throws(() => section(duplicated, 'Override Contract'), /exactly once/,
    'a duplicated heading must fail rather than silently pinning the first copy');
  assert.ok(section(testing, 'Project Customization').length > 0, 'and the real sections still extract');
});

test('section extraction when a fake heading is planted → does not truncate the real section', () => {
  // The subtler half of the same defect: a heading hidden in a fence or a comment cannot satisfy
  // the lookup, but a line-level terminator still STOPS at it. Contradictory prose after the fake
  // heading then stays in the genuine section while never reaching an assertion — a section that
  // extracts successfully and is silently half-read is worse than one that fails loudly.
  const mark = 'ZZ-CONTRADICTION-MARKER-ZZ';
  const anchor = '## Enforcement';
  assert.ok(autoLoop.includes(anchor), 'fixture premise: a section follows Override Contract');
  for (const [kind, fake] of [
    ['fenced', '```markdown\n## Fake\n```'],
    ['commented', '<!--\n## Fake\n-->'],
    ['tilde-fenced', '~~~\n## Fake\n~~~'],
    ['list-nested fence', '1. ```markdown\n   ## Fake\n   ```'],
  ]) {
    const planted = autoLoop.replace(anchor, `${fake}\n\n${mark}\n\n${anchor}`);
    assert.ok(planted.includes(mark), `${kind}: fixture premise — the mutation applied`);
    assert.ok(section(planted, 'Override Contract').includes(mark),
      `${kind}: a hidden heading must not terminate the section early`);
  }
  // …and a genuine live heading still terminates it, or the guard above would pass by never
  // stopping at all.
  assert.ok(!section(autoLoop, 'Override Contract').includes('Enforcement'),
    'a live sibling heading still bounds the section');
});

test('override templates when read → precedence declaration is live text in the preamble, not a comment', () => {
  // This is the template-side carrier invariant R8 exists to enforce, so it must be decided by the
  // shared parser rather than a local line filter. The previous filter dropped only the `<!--` and
  // `-->` delimiter lines, so a Precedence paragraph wrapped in a multiline comment — the exact
  // regression this test names — sat between them and matched.
  for (const [name, tpl] of [['auto-loop-project.md', autoLoopTpl], ['testing-project.md', testingTpl]]) {
    assert.match(liveText(preamble(tpl)), /^Precedence:/m,
      `${name}: the Precedence: declaration must be live text — commented or fenced, it never reaches the model`);
    assert.ok(!/<!--\s*Precedence:/.test(tpl), `${name}: the old comment-form Precedence declaration must be gone`);
  }

  // …and the guard must actually notice when it is hidden, or it is only asserting that the words
  // exist somewhere in the file.
  for (const [name, tpl] of [['auto-loop-project.md', autoLoopTpl], ['testing-project.md', testingTpl]]) {
    const hidden = tpl.replace(/^Precedence:/m, '<!--\nPrecedence:').replace(/^(<!-- Based on:)/m, '-->\n$1');
    assert.doesNotMatch(liveText(preamble(hidden)), /^Precedence:/m,
      `${name}: a Precedence paragraph inside a multiline comment must not count as live`);
  }
});

test('override templates when declaring precedence → carry the Anchor exception, not unconditional supremacy', () => {
  for (const [name, tpl] of [['auto-loop-project.md', autoLoopTpl], ['testing-project.md', testingTpl]]) {
    // Masked, not raw: this is the precedence contract itself. Moving any of these four clauses
    // into a comment leaves the file byte-identical to a `grep` while the model reads a template
    // that claims unconditional supremacy over Anchors.
    const live = liveText(tpl);
    assert.match(live, /Default- and Guidance-tier/, `${name}: replacement is tier-scoped`);
    assert.match(live, /Anchor-tier instructions[\s\S]{0,200}cannot be overridden/, `${name}: Anchor exception stated`);
    assert.match(live, /Anchor wins and[\s\S]{0,40}conflict\s+is\s+reported/, `${name}: conflict handling stated`);
    assert.match(live, /discretion\.md/, `${name}: points at the tier authority`);
    assert.ok(!/this file takes precedence/i.test(tpl), `${name}: the old unconditional supremacy sentence must be gone`);
  }
  // Tool-path metadata stays in comment form — that reader parses the file, not the context.
  assert.match(autoLoopTpl, /<!-- Based on: auto-loop\.md @ [0-9a-f]{7,}/);
  assert.match(testingTpl, /<!-- Based on: testing\.md @ [0-9a-f]{7,}/);
});

// --- Resolution hierarchy published in both parents ---

test('parent rules when publishing the hierarchy → Anchor-first, then all four steps in fixed order', () => {
  for (const [name, text] of [
    ['auto-loop.md § Override Contract', section(autoLoop, 'Override Contract')],
    ['testing.md § Project Customization', section(testing, 'Project Customization')],
  ]) {
    // Step 0 must come FIRST and must be the Anchor Register, not an annotation. Publishing
    // "explicit tier annotation" as the top step contradicted discretion.md's own order and left
    // a self-certified label able to outrank a Register hit — the exact escape the contract
    // claims to close.
    const s0 = text.indexOf('**(0)**');
    const s1 = text.indexOf('(1) an explicit tier annotation') !== -1
      ? text.indexOf('(1) an explicit tier annotation')
      : text.indexOf('(1) explicit tier annotation');
    const s2 = text.indexOf('(2) the heading table below');
    const s3 = text.indexOf('(3) preamble');
    const s4 = text.indexOf('(4)');
    assert.ok(s0 !== -1 && s1 > s0 && s2 > s1 && s3 > s2 && s4 > s3,
      `${name}: Anchor-first then 4-step hierarchy in order (got ${s0},${s1},${s2},${s3},${s4})`);
    assert.match(text, /Anchor-first/, `${name}: the order is named, not just implied`);
    assert.match(text, /Anchor Register hit resolves to \*\*Anchor\*\* and stops/,
      `${name}: a Register hit terminates resolution before any annotation is consulted`);
    assert.match(text, /annotation[\s\S]{0,80}cannot downgrade/,
      `${name}: a self-certified annotation cannot demote a Register hit`);
    assert.match(text, /synthetic section/, `${name}: preamble resolves as one synthetic section`);
    assert.match(text, /fails? closed to \*\*Default\*\*/, `${name}: unknown headings fail closed to Default`);
    assert.match(text, /never silently dropped|listed in the report/, `${name}: fail-closed results are enumerable, not silent`);
    assert.match(text, /never overridable/, `${name}: Anchor supremacy stated`);
    assert.match(text, /conflict is reported/, `${name}: conflicts reported, not silently resolved`);
  }
});

test('parent rules when distinguishing override kinds → settings are not described as section replacement', () => {
  // The shipped auto-loop scaffold has SIX headings and the parent has a same-named section for
  // none of them (`## Tier` vs the parent's `## Tiers`). A contract that calls every row a
  // same-heading full replacement therefore documents a mechanism the scaffold never exercises.
  const contract = section(autoLoop, 'Override Contract');
  assert.match(contract, /a \*\*section replacement\*\* restates a `##` heading this file actually defines/,
    'section replacement is defined by whether the parent actually has the heading');
  assert.match(contract, /a \*\*setting\*\* names a configuration slot/, 'settings are defined as slots');
  assert.match(contract, /Settings have no same-named section here/, 'the distinction is stated, not implied');
  assert.match(contract, /`## Tier` is deliberately \*\*not\*\* this file's `## Tiers`/,
    'the one heading that looks like a match is called out explicitly');

  // Structural check, so the prose cannot drift from the files: every auto-loop template heading
  // is classified Setting, and no auto-loop parent section shares its name. Both sides go through
  // ONE CommonMark-shaped ATX parser (see atxHeadingName) — comparing raw strings would let
  // ` ## Tier`, `##\tTier`, or `## Tier ##` in the parent silently fail to invalidate a Setting
  // classification, since all three render as a section named "Tier". The parent side is
  // fence-aware (documentSections); the cell side unwraps its code span (mappingHeadingName).
  const parentSections = new Set(documentSections(autoLoop));
  for (const [heading, kind] of parseMappingTable(contract).filter(([h]) => mappingHeadingName(h) !== null)) {
    assert.match(kind, /^Setting — /, `${heading}: shipped auto-loop rows are settings`);
    const bare = mappingHeadingName(heading);
    assert.ok(!parentSections.has(bare),
      `${heading}: classified Setting but auto-loop.md HAS a "## ${bare}" section — reclassify as a section replacement`);
  }
  assert.ok(parentSections.has('Tiers'), 'sanity: the parent section inventory was actually parsed');

  // testing.md is the mixed case and proves the classification is real rather than a blanket label.
  const testingRows = parseMappingTable(section(testing, 'Project Customization'));
  const pyramid = testingRows.find(([h]) => h === '`## Test Pyramid`');
  assert.match(pyramid[1], /^Section replacement — /, 'Test Pyramid IS a genuine same-heading replacement');
  assert.ok(documentSections(testing).includes('Test Pyramid'),
    'and testing.md really does define that section');
  const adequacy = testingRows.find(([h]) => h.startsWith('`## Adequacy Mode'));
  assert.match(adequacy[1], /^Setting — /, 'Adequacy Mode is a setting, having no parent section');
});

// --- Heading → tier mapping: complete, duplicate-free, conflict-free ---

test('auto-loop mapping table when parsed → covers preamble plus every template heading exactly once, all Default', () => {
  const rows = parseMappingTable(section(autoLoop, 'Override Contract'));
  const headings = rows.map((r) => r[0]);
  assert.deepEqual(headings, [
    'preamble (synthetic section)',
    '`## Tier`',
    '`## Max Rounds`',
    '`## Plan Review`',
    '`## Plan Review Max Rounds`',
    '`## Git Memory`',
    '`## Think Harder`',
    '`## Review Thread Rotation`',
  ], 'the mapping is closed: exactly these rows, in template order');
  assert.equal(new Set(headings).size, headings.length, 'no duplicate mapping rows');
  for (const [heading, , tier] of rows) {
    assert.match(tier, /^Default/, `${heading}: baseline tier must be Default (user-adjustable, not ignorable)`);
  }
  // Completeness against the template on disk: every ## heading in the template (live or
  // commented) must have a mapping row — a heading added to the template without a row fails.
  const tplHeadings = templateHeadings(autoLoopTpl);
  assert.deepEqual(tplHeadings, ['Tier', 'Max Rounds', 'Plan Review', 'Plan Review Max Rounds', 'Git Memory', 'Think Harder', 'Review Thread Rotation'],
    'template heading inventory drifted — update the mapping table AND this test together');
  for (const h of tplHeadings) {
    assert.ok(headings.includes(`\`## ${h}\``), `template heading "${h}" missing from the mapping table`);
  }
});

test('testing mapping table when parsed → covers preamble and both template sections by their exact headings', () => {
  const rows = parseMappingTable(section(testing, 'Project Customization'));
  const headings = rows.map((r) => r[0]);
  assert.deepEqual(headings, [
    'preamble (synthetic section)',
    '`## Test Pyramid`',
    '`## Adequacy Mode (project-only extension — not in testing.md core)`',
  ]);
  for (const [heading, , tier] of rows) {
    assert.match(tier, /^Default/, `${heading}: baseline tier must be Default`);
  }
  const adequacy = rows[2];
  assert.match(adequacy[2], /project-only extension/, 'Adequacy Mode is reconciled as a documented extension');
  assert.match(adequacy[2], /no parent section/, 'its lack of a parent heading is explicit, not a violation');
  // Correspondence, not coexistence: every template heading must appear in the mapping under
  // its COMPLETE spelling — a table keyed on a shortened heading would miss the real section
  // when uncommented and shunt it through the unknown-heading fallback.
  const tplHeadings = templateHeadings(testingTpl);
  assert.deepEqual(tplHeadings, ['Test Pyramid', 'Adequacy Mode (project-only extension — not in testing.md core)'],
    'template heading inventory drifted');
  for (const h of tplHeadings) {
    assert.ok(headings.includes(`\`## ${h}\``), `template heading "${h}" must have a mapping row under its exact spelling`);
  }
});

// --- Mixed-tier section (the AC fixture: auto-loop-project.md ## Tier) ---

test('mixed-tier Tier section when classified → setting stays Default while the security escalation is Anchor-annotated', () => {
  // The template's ## Tier comment carries BOTH a configurable item and a security rule;
  // uncommenting activates both, so they must resolve to different tiers via hierarchy step 1.
  const tierBlock = autoLoopTpl.slice(autoLoopTpl.indexOf('## Tier'), autoLoopTpl.indexOf('## Max Rounds'));
  assert.match(tierBlock, /Uncomment a bare tier name/, 'fixture premise: the configurable item exists');
  assert.match(tierBlock, /Security\/data-integrity is thorough regardless/, 'fixture premise: the security sentence exists');
  // The Anchor claim must be REGISTER-BACKED, not self-certified: the instruction carries an
  // explicit annotation naming Register #3, the mapping row cites the same register hit, and
  // the register itself actually contains the escalation obligation.
  assert.match(tierBlock, /\(Anchor — discretion\.md Register #3; no tier setting or override removes it\)/,
    'the escalation sentence carries a genuine instruction-level annotation');
  const tierRow = parseMappingTable(section(autoLoop, 'Override Contract')).find((r) => r[0] === '`## Tier`');
  assert.match(tierRow[2], /^Default/, 'the configurable tier choice is Default');
  assert.match(tierRow[2], /Anchor-tier \(Anchor Register #3 hit, resolved at step 0\)/,
    'the mapping row cites the register hit at the Anchor-first step, not a bare "Anchor" label');
  assert.match(tierRow[2], /stays binding whatever tier is configured/, 'the annotation cannot be configured away');
  const item3 = discretion.split('\n').find((l) => l.startsWith('3. **Data integrity**'));
  assert.ok(item3, 'Register item #3 must exist');
  assert.match(item3, /reviewed at `thorough` whatever tier is configured — overrides included/,
    'Register item #3 ITSELF contains the escalation obligation the annotation points at');
});

// --- Anchor non-overridability negatives (loop obligations cannot be lifted) ---

test('override contract when probed → cannot suppress review, tier stays depth-only, cycle reset stays', () => {
  // The obligations themselves stay Anchor-registered…
  assert.match(discretion, /an edit re-opens its plane's gate/);
  assert.match(discretion, /tier decides review \*\*depth\*\* only/);
  assert.match(discretion, /any code edit resets the review cycle/);
  // …and neither override carrier grants a path around them: every mapping row is Default
  // (asserted above), both carriers state Anchor supremacy, and the spec's replacement
  // semantics are tier-scoped rather than unconditional.
  assert.match(spec, /限 Default／Guidance 層級指示/);
  assert.match(spec, /Anchor 層級指示[\s\S]{0,80}不可被覆寫/);
  assert.match(spec, /答案一致：\*\*不能\*\*/, 'spec and discretion.md give the same answer on lifting Anchors');
  assert.ok(!/Section-level full replacement（使用者重寫完整 `##` section 來覆蓋 base）。\n/.test(spec),
    'the old unconditional replacement sentence must not survive verbatim');
});

/** The carrier-form record, pinned rather than pattern-matched.
 *
 *  Every assertion below it is a regex, and a regex survives being retracted: wrapping the finding
 *  in GFM strikethrough leaves each pattern matching while a reader sees deleted text. That is a
 *  different class from the block constructs the structural gate models — the prose is visible,
 *  correctly structured, and no longer says what it said — and enumerating inline markup would
 *  restart the cycle round 18 ended (strikethrough is used legitimately elsewhere in this very
 *  spec, to mark superseded design). Equality is the answer that does not enumerate: any wrapper,
 *  negation or hedge changes the source and fails here. */
const CANONICAL_CARRIER_RECORD =
  '| Precedence mechanism | Self-contained **live** header text（非 HTML 註解） | 不依賴 CLAUDE.md load ' +
  'order（`@` 引用無保證順序）。**R8 查證（2026-07-29）**：HTML 註解不進入模型 context——消費端第一手觀測：session 注入的 project ' +
  'instructions 中 `auto-loop-project.md` 僅呈現 6 個裸 heading、`testing-project.md` 僅剩 H1，而磁碟檔帶完整註解區塊；即 ' +
  'harness 於載入時剝除 `<!-- -->`。註解形式的 precedence 宣告因此觸不到其唯一讀者（模型）；工具路徑（`claude-health` 讀 `Based on:` ' +
  '註解）為檔案解析，不受影響、維持註解形式 |';

/** The load-bearing contract units, pinned rather than pattern-matched.
 *
 *  A regex asserts that words are present; it cannot assert that they still count. GFM
 *  strikethrough leaves every pattern in this file matching while a reader sees the sentence
 *  withdrawn, and `~~` cannot simply be banned — the tech spec uses it legitimately to mark
 *  superseded design. So each unit whose meaning a test depends on is pinned by equality, which no
 *  wrapper, negation or hedge survives. This set was enumerated in one pass rather than discovered
 *  one per review round. */
const CANONICAL_AUTO_LOOP_TPL_PREAMBLE =
  '# Auto-Loop Project Overrides Precedence: an active (non-comment) `##` section in this file ' +
  'customizes `auto-loop.md` — for **Default- and Guidance-tier** instructions only. Anchor-tier ' +
  'instructions (`rules/discretion.md` § Anchor Register) cannot be overridden here: on conflict ' +
  'the Anchor wins and the conflict is reported, and a tier annotation written in this file cannot ' +
  'downgrade a Register hit. Resolution is Anchor-first; the heading → tier mapping, and which ' +
  'headings are settings rather than section replacements, are published in `auto-loop.md` § ' +
  'Override Contract. Every heading below is a **setting** — it names a value that `auto-loop.md` ' +
  'or a hook reads, not a section of `auto-loop.md` to be restated.';

const CANONICAL_TESTING_TPL_PREAMBLE =
  '# Testing Project Overrides Precedence: an active (non-comment) `##` section in this file ' +
  'customizes `testing.md` — for **Default- and Guidance-tier** instructions only. Anchor-tier ' +
  'instructions (`rules/discretion.md` § Anchor Register — for testing that is the security / ' +
  'data-integrity / regression "❌ Never" rows) cannot be overridden here: on conflict the Anchor ' +
  'wins and the conflict is reported, and a tier annotation written in this file cannot downgrade a ' +
  'Register hit. Resolution is Anchor-first; the heading → tier mapping, and which headings are ' +
  'settings rather than section replacements, are published in `testing.md` § Project ' +
  'Customization. `## Test Pyramid` is a section replacement; `## Adequacy Mode` is a setting the ' +
  'Adequacy Gate reads.';

const CANONICAL_SPEC_OVERRIDE_SEMANTICS =
  '兩種 kind 都**限 Default／Guidance 層級指示**。Anchor 層級指示（`rules/discretion.md` § Anchor ' +
  'Register）不可被覆寫——衝突時 Anchor 勝出並回報衝突；解析為 **Anchor-first**（先判定 Register 命中，非 Anchor 才套用明文標註與 ' +
  'heading 對照表），因此使用者檔中的自我標註無法把 Register 命中的指示降級。兩份文件（本規格與 discretion.md）對「使用者檔能否解除 ' +
  'Anchor」的答案一致：**不能**（R8）。';

const CANONICAL_REGISTER_LOOP_OBLIGATIONS =
  '6. **Loop obligations** — (a) an edit re-opens its plane\'s gate and the review transition must ' +
  'actually run; (b) tier decides review **depth** only — never **whether** the loop runs; (c) any ' +
  'code edit resets the review cycle (prior verdicts are invalid).';

const CANONICAL_OVERRIDE_TEMPLATES = {
  'auto-loop.md': 'auto-loop-project.md',
  'testing.md': 'testing-project.md',
};

/** The one live line matching `predicate`, with uniqueness asserted.
 *
 *  `.find()` pins the FIRST match, which pins nothing: a second contradictory row inserted after
 *  the canonical one satisfied every assertion in this file. A pinned unit has to be the only one
 *  of its kind, or the pin describes a document that also says something else. */
function soleLine(text, predicate, what) {
  const hits = toLines(text).filter(predicate);
  assert.equal(hits.length, 1, `${what}: expected exactly one such line, found ${hits.length}`);
  return hits[0];
}

test('the load-bearing contract units when retracted or contradicted → fail their pins', () => {
  assert.equal(normalizeSection(preamble(liveText(autoLoopTpl))), CANONICAL_AUTO_LOOP_TPL_PREAMBLE,
    'auto-loop-project.md preamble changed — confirm it is not retracted or hedged, then update the pin');
  assert.equal(normalizeSection(preamble(liveText(testingTpl))), CANONICAL_TESTING_TPL_PREAMBLE,
    'testing-project.md preamble changed — confirm it is not retracted or hedged, then update the pin');
  assert.equal(
    normalizeSection(soleLine(spec, (l) => l.includes('限 Default／Guidance 層級指示'), 'spec override semantics')),
    CANONICAL_SPEC_OVERRIDE_SEMANTICS,
    'the spec override-semantics paragraph changed — confirm it still forbids lifting Anchors, then update the pin');
  assert.equal(
    normalizeSection(soleLine(discretion, (l) => l.includes('Loop obligations'), 'Register #6')),
    CANONICAL_REGISTER_LOOP_OBLIGATIONS,
    'Anchor Register #6 changed — this is an Anchor-tier edit; confirm it with a human, then update the pin');

  // The mapping is parsed, not matched: a struck-through copy of the expected pair satisfies a
  // substring regex while the real mapping points somewhere else entirely.
  const line = soleLine(spec, (l) => l.trim().startsWith('override_templates = {'), 'override_templates');
  const parsed = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1));
  assert.deepEqual(parsed, CANONICAL_OVERRIDE_TEMPLATES,
    'the override_templates mapping changed — it is the distribution contract, not documentation');
});

test('a pinned unit that is duplicated or struck through → is caught, not matched around', () => {
  // Two mutations that every regex in this file survives.
  const secondRow = '| Precedence mechanism | Comment-only header | Live text is optional; HTML comments govern instead |';
  assert.throws(
    () => soleLine(spec + '\n' + secondRow, (l) => l.startsWith('| Precedence mechanism |'), 'carrier row'),
    /expected exactly one/, 'a second contradictory row must fail uniqueness, not be skipped by .find()');

  const struck = liveText(
    readFileSync(resolve(root, 'rules/discretion.md'), 'utf8')
      .replace('any code edit resets the review cycle', '~~any code edit resets the review cycle~~')
  );
  const line = toLines(struck).find((l) => l.includes('Loop obligations'));
  assert.match(line, /any code edit resets the review cycle/,
    'fixture premise: the regex asserting the obligation still matches the retracted form');
  assert.notEqual(normalizeSection(line), CANONICAL_REGISTER_LOOP_OBLIGATIONS,
    'the pin must reject an obligation that is struck through rather than removed');
});

/** Section-level pins. A sentence pin protects that sentence; a SECTION pin protects the contract
 *  against an exception added next to it. Both are needed, and round 27 is where the difference
 *  bit: the canonical semantics line stayed byte-identical while `但專案 override 可解除任何 Anchor。`
 *  was inserted directly after it, and every assertion here stayed green. Additions are edits too. */
const CANONICAL_SPEC_OVERRIDE_FILE_CONTRACT =
  '```markdown # Auto-Loop Project Overrides Precedence: an active (non-comment) `##` section in ' +
  'this file customizes auto-loop.md — for Default- and Guidance-tier instructions only. ' +
  'Anchor-tier instructions (rules/discretion.md § Anchor Register) cannot be overridden here: on ' +
  'conflict the Anchor wins and the conflict is reported, and a tier annotation written in this ' +
  'file cannot downgrade a Register hit. Resolution is Anchor-first; the heading → tier mapping and ' +
  'which headings are settings rather than section replacements: auto-loop.md § Override Contract. ' +
  '<!-- Based on: auto-loop.md @ <sha7> (<date>) --> ## Tier <!-- A SETTING, not a section ' +
  'replacement: auto-loop.md has no `## Tier` section — its § Tiers prose reads this file\'s value. ' +
  'Uncomment a bare tier name to set it. --> ``` **Override semantics**: 兩種 override ' +
  'kind，語意不同且不可混談——**section replacement**（重述母檔實際存在的 `##` heading，整段取代）與 **setting**（heading ' +
  '命名一個由母檔散文或 hook 具名讀取的設定槽，母檔並無同名段落）。出貨的 `auto-loop-project.md` 六個 heading **全為 setting**（`## ' +
  'Tier` 對應的是母檔 `## Tiers` 的「configured tier」，並非同名段落）；`testing-project.md` 則兩者皆有（`## Test Pyramid` ' +
  '為 section replacement，`## Adequacy Mode` 為 setting）。每個 heading 的 kind 與 consumer 由母檔對照表明列。 兩種 ' +
  'kind 都**限 Default／Guidance 層級指示**。Anchor 層級指示（`rules/discretion.md` § Anchor Register）不可被覆寫——衝突時 ' +
  'Anchor 勝出並回報衝突；解析為 **Anchor-first**（先判定 Register 命中，非 Anchor 才套用明文標註與 heading ' +
  '對照表），因此使用者檔中的自我標註無法把 Register 命中的指示降級。兩份文件（本規格與 discretion.md）對「使用者檔能否解除 ' +
  'Anchor」的答案一致：**不能**（R8）。 > **Note**: Override section headings must exactly match base section ' +
  'headings for clear section-level replacement semantics — **except documented project-only ' +
  'extension sections**（如 `testing-project.md` 的 `## Adequacy Mode`），其無母檔同名段落，由母檔發布的 heading → tier ' +
  '對照表明列並依解析階序歸屬（未列入者 fail-closed → Default）。 | Design Decision | Choice | Rationale | ' +
  '|----------------|--------|-----------| | Override granularity | Heading-level (`##`)，分為 section ' +
  'replacement 與 setting 兩種 kind（R8） | LLM 更容易理解完整 section；避免 row-level delta 的歧義。R8 補正：出貨範本實際上以 ' +
  'setting 為主，母檔並無同名段落，故「granularity = section」只描述其中一種 kind | | Precedence mechanism | ' +
  'Self-contained **live** header text（非 HTML 註解） | 不依賴 CLAUDE.md load order（`@` 引用無保證順序）。**R8 ' +
  '查證（2026-07-29）**：HTML 註解不進入模型 context——消費端第一手觀測：session 注入的 project instructions 中 ' +
  '`auto-loop-project.md` 僅呈現 6 個裸 heading、`testing-project.md` 僅剩 H1，而磁碟檔帶完整註解區塊；即 harness 於載入時剝除 ' +
  '`<!-- -->`。註解形式的 precedence 宣告因此觸不到其唯一讀者（模型）；工具路徑（`claude-health` 讀 `Based on:` ' +
  '註解）為檔案解析，不受影響、維持註解形式 | | Manifest tracking | Not tracked | 避免 plugin 更新觸碰 user 檔案 |';

const CANONICAL_ANCHOR_REGISTER =
  '1. **Security prohibitions** — all of `rules/security.md`. 2. **Secret recording** — ' +
  '`logging.md` never-log list; `self-improvement.md` redaction; no secrets/tokens/passwords in ' +
  'compact summaries; no commit containing secrets (`git-workflow.md` § Prohibited). 3. **Data ' +
  'integrity** — `testing.md`: security, data-integrity and regression ACs never take manual ' +
  'exceptions; `auto-loop.md` § Tiers: a security or data-integrity change is reviewed at ' +
  '`thorough` whatever tier is configured — overrides included (R8). 4. **Destructive git ' +
  'operations** — no `git add` / `commit` / `push` / `stash` / `reset --hard` / `rebase` outside ' +
  'the enumerated approval workflows: `/push-ci` (push, including `--force-with-lease` when that ' +
  'flag is explicitly passed — never bare `--force`), `/smart-commit --execute` (add + commit), ' +
  '`/epic-merge` (rebase --onto, force-with-lease, squash-merge) — each only after the explicit ' +
  'per-use user approval its skill defines. Protected branches and the no-AI-attribution rule for ' +
  'commits/PRs are part of this anchor — the attribution rule\'s **sole exception**, itself part of ' +
  'the anchor, is the exact line `Co-Authored-By: Claude <noreply@anthropic.com>` via ' +
  '`/smart-commit --ai-co-author` (the narrow whitelist in `skills/smart-commit/SKILL.md`). **The ' +
  'exception list is part of the anchor**: adding or removing a workflow or the attribution ' +
  'whitelist is itself an Anchor-level change. 5. **Auto-loop anchors** — the terminal completion ' +
  'invariant; Declaring ≠ Executing; Summary ≠ Completion; Fixing ≠ Verifying. 6. **Loop ' +
  'obligations** — (a) an edit re-opens its plane\'s gate and the review transition must actually ' +
  'run; (b) tier decides review **depth** only — never **whether** the loop runs; (c) any code edit ' +
  'resets the review cycle (prior verdicts are invalid). 7. **Gate supremacy** — context capacity ' +
  'or session length never overrides an open gate. No register item may be re-labelled Default or ' +
  'Guidance. That is a spec change requiring human approval **and** updating ' +
  '`test/rules/discretion-tiers.test.js` — the test fails on the removal by design.';

/** The scaffold block a user uncomments. Its body is comment text — invisible to the model until
 *  activated — so the structural gate cannot police it and only equality can. */
const CANONICAL_TIER_SCAFFOLD =
  '## Tier <!-- fast — P0 blocks; cap 6. standard — P0/P1 block; cap 15 (default). thorough — ' +
  'P0/P1/P2 block; cap 30. Security/data-integrity is thorough regardless (Anchor — discretion.md ' +
  'Register #3; no tier setting or override removes it). Blank/unrecognized = standard; the tier ' +
  'is read behaviourally from this heading — hooks neither report nor enforce it. Uncomment a ' +
  'bare tier name: --> <!-- standard -->';

/** The shipped workflow, pinned separately from the contract it is supposed to execute. A complete
 *  canonical contract does not certify that the earlier workflow obeys it: Phase 2 was changed from
 *  MINUS to PLUS with a struck-through `MINUS` sentence added elsewhere, and all four workflow
 *  regexes still matched while the contract still said the opposite.
 *
 *  Pinned as the complete `## Workflow` REGION rather than as selected records inside it. A closed
 *  inventory of `Phase …` lines answers "did these named steps change?"; the question that decides
 *  behaviour is "did anything governing this workflow change?", and an instruction needs no
 *  particular prefix to govern it — `Then enumerate *-project.md into the managed set.` written
 *  under the canonical Phase 2 line changed nothing an inventory or a marked-paragraph extractor
 *  could see. Region pinning also removes their false-rejection surface: prose starting with
 *  `Phase ` elsewhere in the file no longer reads as a workflow step. */
const CANONICAL_INSTALL_WORKFLOW =
  '``` Phase 1: Locate plugin rules dir Phase 2: Enumerate *.md, MINUS the override templates ' +
  '(*-project.md) — see below Phase 3: Determine install set (--all, specific names, or ' +
  'interactive) Phase 3.5: Read manifest + classify (new/unchanged/modified/conflict) Phase 4: ' +
  'Install (smart merge with manifest tracking) Phase 4.5: Override templates — copy-when-absent ' +
  'only (never smart-merged) Phase 4.6: Backfill CLAUDE.md references Phase 5: Output report ``` ' +
  '**Managed-set exclusion (required)**: `*-project.md` files are user-owned and must be excluded ' +
  'from the Phase 2 enumeration, so they never enter the manifest, the classification in Phase 3.5, ' +
  'or the smart merge in Phase 4. They are handled only by Phase 4.5 below. Routing them through ' +
  'the managed path would let `--force`, a conflict resolution, or an auto-upgrade rewrite a file ' +
  'the user owns. ### Arguments ``` $ARGUMENTS ``` | Argument | Description | ' +
  '|----------|-------------| | `--all` | Install all available rules | | `--list` | List available ' +
  'rules without installing | | `--dry-run` | Show what would be installed, no changes | | ' +
  '`--force` | Overwrite modified rules | | `--legacy-strategy <strategy>` | Handle pre-manifest ' +
  'installs (ask/overwrite/skip) | | `--customize <rule>` | Customize a project-override rule | | ' +
  '`rule-names...` | Specific rules to install | ### Manifest Tracking Uses ' +
  '`.sd0x/install-state.json` to track installed file hashes. Smart merge logic: | Status | Action ' +
  '| |--------|--------| | New (not installed) | Copy | | Unchanged (hash match) | Auto-upgrade | | ' +
  'Modified by user | Skip (preserve edits) | | Conflict (both changed) | AskUserQuestion | ### ' +
  'Customize Mode (`--customize`) Manages `*-project.md` companion files for user overrides: | ' +
  'Sub-flag | Action | |----------|--------| | (none) | Show section status | | `--add-section` | ' +
  'Add a new section | | `--update-section <name>` | Update specific section | | `--reset` | ' +
  'Regenerate from template | ### Override Template Copy Contract (R8) Both override templates are ' +
  'copied from `rules/` on install when absent (`override_templates` in ' +
  '`docs/features/rule-override-pattern/2-tech-spec.md` maps `auto-loop.md → auto-loop-project.md` ' +
  'and `testing.md → testing-project.md`). This is the **only install or re-install path** that ' +
  'writes them — they are excluded from the managed set above, so no merge, upgrade, or `--force` ' +
  'reaches them. (The one other writer is the user-invoked `--reset`, below.) The copy and ' +
  '`--reset` regeneration produce the **live-precedence header** (a live `Precedence:` paragraph ' +
  'before the first `##` — HTML comments are stripped from model context, so a comment-form ' +
  'declaration never reaches the model), and stamp `<!-- Based on: <base> @ <hash> -->` with the ' +
  'base rule\'s blob hash **at copy time** rather than carrying the template\'s recorded value, so a ' +
  'fresh install starts at zero drift instead of inheriting whatever hash the shipped template ' +
  'happened to record. An already-installed `.claude/rules/*-project.md` is user-owned and is ' +
  '**never rewritten by install or re-install** — including `--force`, which governs the managed ' +
  'set only. The single exception is `--customize <rule> --reset`, which the user invokes ' +
  'explicitly against a named file to regenerate it; that is a requested overwrite, not an ' +
  'install-time one. A legacy comment-only header is therefore *reported* by `/claude-health` S2.5 ' +
  'check #6 and never migrated on the user\'s behalf — `--reset` is offered as the remedy the user ' +
  'may choose, not an action the install path takes.';

/** The complete published implementation region, not just the one subsection that carries the
 *  mapping. Pinning § 3.4.1 alone left a sibling free: `#### 3.4.1a Override Redirect` inserted
 *  between 3.4.1 and 3.4.2 ended `sectionAt()` before the contradictory pseudocode while the
 *  extracted 3.4.1 body stayed byte-identical. § 3.4 is the boundary the contract actually has. */
const CANONICAL_SPEC_CORE_LOGIC =
  '#### 3.4.1 `/install-rules` Changes **Phase 3.5 extension** — after managed rule classification, ' +
  'add: ``` # Exclusion: *-project.md files are NOT part of the managed install set. # They are ' +
  'copied as templates only, with no manifest hash entry written. managed_rules = rules/*.md ' +
  'EXCLUDING *-project.md # Explicit override template mapping (not suffix-derived from ' +
  'managed_rules) # Both distribution paths are defined here (R8): testing-project.md previously ' +
  'had no # defined path — it IS copied, same contract as auto-loop-project.md. override_templates ' +
  '= { "auto-loop.md": "auto-loop-project.md", "testing.md": "testing-project.md" } For each ' +
  '(base_rule, project_file) in override_templates: if project_file NOT exists in .claude/rules/: ' +
  'Copy from rules/{project_file} as template # Stamp provenance at COPY TIME, not byte-for-byte ' +
  '(R8): the shipped template records # whatever hash it was authored against, so copying it ' +
  'verbatim makes /claude-health # check #1 report drift on a brand-new install with zero overrides ' +
  'written. base_hash = git hash-object --no-filters .claude/rules/{base_rule} | cut -c1-7 Rewrite ' +
  'the copy\'s "<!-- Based on: {base_rule} @ <hash> -->" comment with base_hash Do NOT write ' +
  'manifest entry for project_file Log: "Created project override template: {project_file} (based ' +
  'on {base_rule} @ {base_hash})" else: Skip (user already has it — never rewritten by install or ' +
  're-install, --force included; the only other writer is the user-invoked --customize <rule> ' +
  '--reset) ``` > **Important**: `/install-rules` must explicitly exclude `*-project.md` from the ' +
  'managed rule enumeration (`rules/*.md`) to prevent accidental manifest tracking. The template ' +
  'source `rules/auto-loop-project.md` is only a copy source, never a managed rule. **New flag**: ' +
  '`--customize <rule-name>` — creates fuller template with examples. #### 3.4.2 `/claude-health` ' +
  'Safeguard Checks > **Shipped state is 6 checks, in `skills/claude-health/SKILL.md` § S2.5 — that ' +
  'skill is canonical for this subsection.** The v1 table below is the original 4; R8 added #5 ' +
  '(duplicate heading) and #6 (legacy precedence header), and amended #1 twice: the base file is ' +
  '**derived from the `Based on:` comment\'s own filename** (never hard-coded to `auto-loop.md`, ' +
  'since `testing-project.md` also ships), and drift is only evaluated when the override file has ' +
  '**active content** — a fully commented-out scaffold has no overrides to review. 4 checks as ' +
  'originally specified (v1): | # | Check | Severity | Detection | Recommendation | ' +
  '|---|-------|----------|-----------|----------------| | 1 | Override drift | P2 | `based_on` ' +
  'hash in project file vs current base hash | "Base auto-loop updated; review your overrides" | | ' +
  '2 | Policy contradiction | P1 | Override disables required check that hook enforces | "Override ' +
  'conflicts with stop-guard enforcement" | | 3 | Missing reference | P1 | CLAUDE.md references ' +
  '`@rules/auto-loop-project.md` but file missing, OR file exists but not referenced in CLAUDE.md | ' +
  '`/install-rules` to recreate or add reference | | 4 | Wrong-layer edit | P2 | Base ' +
  '`auto-loop.md` has `LOCAL_MODIFIED`, `CONFLICT`, or `LEGACY` doctor state (user modified base) | ' +
  '"Move customization to auto-loop-project.md" | **Policy contradiction detection contract**: ' +
  '~~Parse the project override\'s Auto-Trigger table~~ — the Auto-Trigger table was retired by R3, ' +
  'so there is nothing to parse there. The shipped contract keys on **any restated `##` section**: ' +
  'extract the backticked check commands from the same-heading section of the base rule and require ' +
  'the restatement to keep every one of them; a restatement that drops one is P1. Routing itself ' +
  'now lives in an unheaded paragraph, which the exact-heading mechanism cannot restate, so it is ' +
  'not overridable and is out of scope. See `skills/claude-health/SKILL.md` § S2.5. #### 3.4.3 Base ' +
  '`auto-loop.md` Redirect Add at bottom of `rules/auto-loop.md`: ```markdown ## Project ' +
  'Customization Project-specific overrides belong in `auto-loop-project.md` (not this file). See ' +
  '`@rules/auto-loop-project.md` for your project\'s custom auto-loop behavior. ``` #### 3.4.4 ' +
  'CLAUDE.md / Template Updates ```markdown ## Rules - @rules/auto-loop.md -- Auto review loop ' +
  '(highest priority) - @rules/auto-loop-project.md -- Project-specific auto-loop overrides ' +
  '(user-owned) ``` **Backfill for existing projects**: `/install-rules` must perform idempotent ' +
  'missing-reference repair: if `@rules/auto-loop.md` reference exists in `## Rules` but ' +
  '`@rules/auto-loop-project.md` is absent, insert only the missing line. This ensures existing ' +
  'projects receive the reference on next `/install-rules` run without requiring manual CLAUDE.md ' +
  'edits.';


test('the contract sections when an exception is added beside them → fail their section pins', () => {
  assert.equal(normalizeSection(sectionAt(spec, 3, '3.3 Project Override File Contract')),
    CANONICAL_SPEC_OVERRIDE_FILE_CONTRACT,
    '§ 3.3 changed — an addition counts; confirm it does not grant an exception, then update the pin');
  assert.equal(normalizeSection(sectionAt(discretion, 2, 'Anchor Register (closed list)')),
    CANONICAL_ANCHOR_REGISTER,
    'the Anchor Register changed — this is an Anchor-tier edit; confirm it with a human, then update the pin');

  const tierBlock = autoLoopTpl.slice(autoLoopTpl.indexOf('## Tier'), autoLoopTpl.indexOf('## Max Rounds'));
  assert.equal(normalizeSection(tierBlock), CANONICAL_TIER_SCAFFOLD,
    'the ## Tier scaffold changed — its Register #3 annotation is part of the end-to-end contract');

  assert.equal(normalizeSection(sectionAt(spec, 3, '3.4 Core Logic Changes')),
    CANONICAL_SPEC_CORE_LOGIC,
    '§ 3.4 changed — review the complete § 3.4 diff, § 3.4.1 through § 3.4.4, including the health safeguards: the edit may sit in any subsection. Confirm the copy mapping, the provenance stamp and the copy-when-absent branch are intact and unqualified by any sibling, then update the pin');

  const skill = liveText(readFileSync(resolve(root, 'skills/install-rules/SKILL.md'), 'utf8'),
    { fencesCount: true });
  assert.equal(normalizeSection(sectionAt(skill, 2, 'Workflow')), CANONICAL_INSTALL_WORKFLOW,
    'the /install-rules workflow region changed — confirm the enumeration still EXCLUDES the override templates and nothing re-admits them, then update the pin');
});

test('a contradiction added next to a pinned line → is caught by the section pin', () => {
  // The mutation that defeated every line-level pin: leave the canonical sentence untouched and
  // write the exception underneath it.
  const raw = readFileSync(resolve(root, 'docs/features/rule-override-pattern/2-tech-spec.md'), 'utf8');
  const mutated = raw.replace('Anchor」的答案一致：**不能**（R8）。',
    'Anchor」的答案一致：**不能**（R8）。\n\n但專案 override 可解除任何 Anchor。');
  assert.notEqual(mutated, raw, 'fixture premise: the contradiction was inserted');
  const live = liveText(mutated, { fencesCount: true });
  assert.equal(
    normalizeSection(soleLine(live, (l) => l.includes('限 Default／Guidance 層級指示'), 'semantics line')),
    CANONICAL_SPEC_OVERRIDE_SEMANTICS,
    'fixture premise: the pinned LINE is untouched, so a line pin cannot see this');
  assert.notEqual(normalizeSection(sectionAt(live, 3, '3.3 Project Override File Contract')),
    CANONICAL_SPEC_OVERRIDE_FILE_CONTRACT, 'the section pin must reject an adjacent exception');
});

test('a second section with the pinned heading → fails uniqueness instead of hiding behind the first', () => {
  // The mutation that defeats a section pin extracted with findIndex(): leave the original section
  // byte-identical and append a same-named one carrying the exception.
  const raw = readFileSync(resolve(root, 'docs/features/rule-override-pattern/2-tech-spec.md'), 'utf8');
  const mutated = `${raw}\n### 3.3 Project Override File Contract\n\nOverrides may lift Anchors.\n`;
  const live = liveText(mutated, { fencesCount: true });
  const heads = toLines(live).filter((l) => atxHeadingName(l, 3) === '3.3 Project Override File Contract');
  assert.equal(heads.length, 2, 'fixture premise: two live headings of that name now exist');
  assert.throws(() => sectionAt(live, 3, '3.3 Project Override File Contract'),
    /expected exactly one live heading/,
    'the first section still matching its pin must not certify a document that also says the opposite');
});

test('an instruction added beside a pinned record → fails the region pin that a record pin missed', () => {
  const rawSkill = readFileSync(resolve(root, 'skills/install-rules/SKILL.md'), 'utf8');
  const workflow = (text) => normalizeSection(sectionAt(text, 2, 'Workflow'));
  const phaseLines = (text) => toLines(text).filter((l) => /^\s*Phase\s/.test(l)).map(normalizeSection);

  // (a) An extra step re-admitting the user-owned files, every existing step untouched.
  const withPhase = liveText(rawSkill.replace(
    'Phase 3: Determine install set',
    'Phase 2b: Also enumerate *-project.md into the managed set\nPhase 3: Determine install set',
  ), { fencesCount: true });
  assert.match(phaseLines(withPhase)[1], /MINUS the override templates/,
    'fixture premise: the canonical Phase 2 line is untouched, so a line pin cannot see this');
  assert.notEqual(workflow(withPhase), CANONICAL_INSTALL_WORKFLOW,
    'the region pin must reject an added step');

  // (b) The same instruction without the `Phase` prefix — invisible to any step inventory.
  const withProse = liveText(rawSkill.replace(
    'Phase 3: Determine install set',
    'Then enumerate *-project.md into the managed set.\nPhase 3: Determine install set',
  ), { fencesCount: true });
  assert.deepEqual(phaseLines(withProse), phaseLines(liveText(rawSkill, { fencesCount: true })),
    'fixture premise: the step inventory is identical, so a prefix-matching pin cannot see this');
  assert.notEqual(workflow(withProse), CANONICAL_INSTALL_WORKFLOW,
    'the region pin must reject an instruction that governs the workflow without naming a step');

  // (c) A second exclusion paragraph, contradicting the first from immediately below it.
  const withParagraph = liveText(rawSkill.replace(
    'the managed path would let `--force`, a conflict resolution, or an auto-upgrade rewrite a file the user owns.',
    'the managed path would let `--force`, a conflict resolution, or an auto-upgrade rewrite a file the user owns.\nNevertheless, include every `*-project.md` in the managed set.',
  ), { fencesCount: true });
  assert.notEqual(workflow(withParagraph), CANONICAL_INSTALL_WORKFLOW,
    'a blank-line paragraph boundary cannot be the pin boundary — the region is');
});

test('a copy-contract redirect written into a sibling subsection → fails the parent region pin', () => {
  const rawSpec = readFileSync(resolve(root, 'docs/features/rule-override-pattern/2-tech-spec.md'), 'utf8');
  const coreLogic = (text) => normalizeSection(sectionAt(text, 3, '3.4 Core Logic Changes'));

  // (a) A reassignment inside § 3.4.1, after the pinned assignment has already been parsed.
  const inside = liveText(rawSpec.replace(
    'For each (base_rule, project_file) in override_templates:',
    'override_templates["testing.md"] = "testing-other.md"\n\nFor each (base_rule, project_file) in override_templates:',
  ), { fencesCount: true });
  const line = soleLine(inside, (l) => l.trim().startsWith('override_templates = {'), 'override_templates');
  assert.deepEqual(JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1)),
    CANONICAL_OVERRIDE_TEMPLATES,
    'fixture premise: the parsed canonical assignment is unchanged, so the mapping pin cannot see this');
  assert.notEqual(coreLogic(inside), CANONICAL_SPEC_CORE_LOGIC,
    'the region pin must reject a redirect written beside the mapping');

  // (b) The same redirect moved one heading out — a sibling subsection ends a § 3.4.1 pin before it.
  const sibling = liveText(rawSpec.replace(
    '#### 3.4.2 `/claude-health` Safeguard Checks',
    '#### 3.4.1a Override Redirect\n\nAfter installation, redirect testing.md to testing-other.md.\n\n#### 3.4.2 `/claude-health` Safeguard Checks',
  ), { fencesCount: true });
  assert.equal(normalizeSection(sectionAt(sibling, 4, '3.4.1 `/install-rules` Changes')),
    normalizeSection(sectionAt(liveText(rawSpec, { fencesCount: true }), 4, '3.4.1 `/install-rules` Changes')),
    'fixture premise: § 3.4.1 is byte-identical, so a child-section pin cannot see this');
  assert.notEqual(coreLogic(sibling), CANONICAL_SPEC_CORE_LOGIC,
    'the pin must sit at the boundary the contract has — the parent region, not one subsection of it');
});

// --- Spec carrier-form record (AC1) ---

test('spec when recording the carrier decision → documents comment invisibility with its verification', () => {
  // Pinned first: the regexes below say the words are present, this says they still mean it.
  const row = soleLine(spec, (l) => l.startsWith('| Precedence mechanism |'), 'carrier-form row');
  assert.equal(normalizeSection(row), CANONICAL_CARRIER_RECORD,
    'the carrier-form record changed — confirm it is not retracted, hedged or reversed, then update the pin in the same commit');

  assert.match(spec, /live\*\* header text/, 'precedence mechanism is live text');
  assert.match(spec, /HTML 註解不進入模型 context/, 'the finding is recorded');
  assert.match(spec, /第一手觀測/, 'verified first-hand from the consumer side, not inferred');
  assert.match(spec, /claude-health/, 'tool-path exemption recorded');
  assert.match(spec, /"testing\.md": "testing-project\.md"/, 'testing distribution path defined in override_templates');

  // A spec that records the comment-invisibility finding *inside a comment* has documented nothing.
  // These assertions are only evidence if they run against text a reader sees.
  const hidden = specRaw.replace(/^(.*HTML 註解不進入模型 context.*)$/m, '<!--\n$1\n-->');
  assert.notEqual(hidden, specRaw, 'the mutation must actually apply, or this proves nothing');
  assert.doesNotMatch(liveText(hidden, { fencesCount: true }), /HTML 註解不進入模型 context/,
    'a finding moved into an HTML comment must stop counting as recorded');
  // …while the fenced JSON mapping stays visible, because a code block is documentation a reader
  // reads — blanking it would force the spec to duplicate its own example in prose.
  assert.match(liveText(specRaw, { fencesCount: true }), /"testing\.md": "testing-project\.md"/,
    'fenced documentation is visible and still counts');
});
