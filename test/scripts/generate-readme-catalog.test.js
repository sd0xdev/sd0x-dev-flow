const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { readFileSync, existsSync, readdirSync, statSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = resolve(__dirname, '../..');
const CATALOG_PATH = join(ROOT, 'docs', 'skill-catalog.yml');
const README_PATH = join(ROOT, 'README.md');
const SKILLS_DIR = join(ROOT, 'skills');
const GENERATOR_PATH = join(ROOT, 'scripts', 'generate-readme-catalog.js');

// ── Catalog validation ──────────────────────────────────

test('skill-catalog.yml exists and is readable', () => {
  assert.ok(existsSync(CATALOG_PATH), 'docs/skill-catalog.yml should exist');
  const content = readFileSync(CATALOG_PATH, 'utf8');
  assert.ok(content.includes('version:'), 'should have version field');
  assert.ok(content.includes('categories:'), 'should have categories section');
  assert.ok(content.includes('skills:'), 'should have skills section');
});

test('all git-tracked skills/ directories have catalog entries', () => {
  // Use git ls-files (index) to check tracked skill directories.
  // This respects staged deletions (git rm --cached) unlike git ls-tree HEAD.
  const { execFileSync } = require('node:child_process');
  let trackedDirs;
  try {
    const out = execFileSync('git', ['ls-files', '--cached', 'skills/'], { encoding: 'utf8', cwd: ROOT });
    const dirSet = new Set(
      out.trim().split('\n').map(p => p.split('/')[1]).filter(Boolean)
    );
    trackedDirs = [...dirSet];
  } catch {
    // Fallback: use all local dirs (CI won't have untracked skills)
    trackedDirs = readdirSync(SKILLS_DIR).filter(d => statSync(join(SKILLS_DIR, d)).isDirectory());
  }
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  const catalogCommands = new Set(
    [...catalog.matchAll(/command:\s*\/(\S+)/g)].map(m => m[1])
  );

  const missing = trackedDirs.filter(dir => !catalogCommands.has(dir));
  assert.deepEqual(
    missing,
    [],
    `skills/ directories missing from catalog: ${missing.join(', ')}`
  );
});

test('all catalog entries have matching skills/ directories', () => {
  const skillDirs = new Set(
    readdirSync(SKILLS_DIR).filter(d => statSync(join(SKILLS_DIR, d)).isDirectory())
  );
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  const commands = [...catalog.matchAll(/command:\s*\/(\S+)/g)].map(m => m[1]);

  const orphaned = commands.filter(cmd => !skillDirs.has(cmd));
  assert.deepEqual(
    orphaned,
    [],
    `catalog entries without skills/ directory: ${orphaned.join(', ')}`
  );
});

test('all catalog entries have valid category', () => {
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  // Extract category IDs from the categories section (before skills section)
  const categoriesSection = catalog.split('skills:')[0];
  const categoryIds = [...categoriesSection.matchAll(/id:\s*(\S+)/g)].map(m => m[1]);
  const validCategories = new Set(categoryIds);

  // Extract skill categories from the skills section
  const skillsSection = catalog.split('skills:')[1] || '';
  const skillCategories = [...skillsSection.matchAll(/category:\s*(\S+)/g)].map(m => m[1]);
  const invalid = skillCategories.filter(c => !validCategories.has(c));
  assert.deepEqual(
    invalid,
    [],
    `invalid categories found: ${[...new Set(invalid)].join(', ')}`
  );
});

test('featured skills have use_when field', () => {
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  const entries = catalog.split(/\n\s{2}- command:/);
  const missing = [];
  for (const entry of entries.slice(1)) {
    const cmd = entry.match(/^\s*\/(\S+)/);
    const featured = entry.includes('featured: true');
    const hasUseWhen = entry.includes('use_when:');
    if (featured && !hasUseWhen && cmd) {
      missing.push(`/${cmd[1]}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `featured skills missing use_when: ${missing.join(', ')}`
  );
});

test('featured skill count is 12-15', () => {
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  const count = (catalog.match(/featured: true/g) || []).length;
  assert.ok(count >= 12 && count <= 15, `expected 12-15 featured, got ${count}`);
});

// ── README marker tests ─────────────────────────────────

test('README.md has all 5 BEGIN/END marker pairs', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const markers = [
    'HERO-COUNT',
    'WHATS-INCLUDED-COUNT',
    'INSTALL-COVERAGE',
    'ESSENTIAL-SKILLS',
    'FULL-CATALOG',
  ];
  for (const m of markers) {
    assert.ok(
      readme.includes(`<!-- BEGIN:${m} -->`),
      `README should have BEGIN:${m} marker`
    );
    assert.ok(
      readme.includes(`<!-- END:${m} -->`),
      `README should have END:${m} marker`
    );
  }
});

test('no unmanaged skill count strings in README', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const cleaned = readme.replace(
    /<!-- BEGIN:\w[\w-]* -->[\s\S]*?<!-- END:\w[\w-]* -->/g,
    ''
  );
  const stale = cleaned.match(/\b\d+ skills\b/g);
  assert.equal(
    stale,
    null,
    `unmanaged skill count strings found: ${(stale || []).join(', ')}`
  );
});

// ── Generator tests ─────────────────────────────────────

test('generator is idempotent (--check exits 0)', () => {
  const result = execFileSync(
    'node',
    [GENERATOR_PATH, '--check'],
    { encoding: 'utf8', cwd: ROOT }
  );
  assert.ok(result.includes('up to date'), 'generator --check should report up to date');
});

test('README full catalog has Review category with Loop Support column', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  assert.ok(
    readme.includes('| Loop Support |'),
    'Review category should have Loop Support column'
  );
});

test('README essential skills table uses Use when column', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const essentialMatch = readme.match(
    /<!-- BEGIN:ESSENTIAL-SKILLS -->([\s\S]*?)<!-- END:ESSENTIAL-SKILLS -->/
  );
  assert.ok(essentialMatch, 'Essential skills block should exist');
  assert.ok(
    essentialMatch[1].includes('| Use when |'),
    'Essential skills should have Use when column'
  );
});

// ── Marker structure regression tests ──────────────────
// Markers must wrap FULL tables (header+separator+rows) to avoid
// HTML comments breaking GitHub table rendering.

test('INSTALL-COVERAGE marker wraps full table (header + separator + rows)', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const block = readme.match(
    /<!-- BEGIN:INSTALL-COVERAGE -->\n([\s\S]*?)\n<!-- END:INSTALL-COVERAGE -->/
  );
  assert.ok(block, 'INSTALL-COVERAGE block should exist');
  const content = block[1];
  assert.ok(content.includes('| Method |'), 'should contain table header');
  assert.ok(content.includes('|-----'), 'should contain separator row');
  assert.ok(content.includes('Plugin install'), 'should contain Plugin install row');
  assert.ok(content.includes('codex-setup init'), 'should contain codex-setup row');
});

test('WHATS-INCLUDED-COUNT marker wraps full table (header + separator + rows)', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const block = readme.match(
    /<!-- BEGIN:WHATS-INCLUDED-COUNT -->\n([\s\S]*?)\n<!-- END:WHATS-INCLUDED-COUNT -->/
  );
  assert.ok(block, 'WHATS-INCLUDED-COUNT block should exist');
  const content = block[1];
  assert.ok(content.includes('| Category |'), 'should contain table header');
  assert.ok(content.includes('|-----'), 'should contain separator row');
  assert.ok(content.includes('| Skills |'), 'should contain Skills row');
  assert.ok(content.includes('| Agents |'), 'should contain Agents row');
  assert.ok(content.includes('| Scripts |'), 'should contain Scripts row');
});

test('no table header between marker and its parent heading', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  // Old broken pattern: heading → table header → separator → marker → rows
  // The regex checks no table separator row immediately precedes BEGIN marker
  const brokenPattern = /\|[-|]+\|\n<!-- BEGIN:(INSTALL-COVERAGE|WHATS-INCLUDED-COUNT) -->/;
  assert.equal(
    brokenPattern.test(readme),
    false,
    'table separator should not appear immediately before BEGIN marker (table must be inside marker)'
  );
});

test('README hero public count matches summary count', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  // Hero now emits "<bundled> bundled · <public> public skills · ..." (v3.0.12)
  const heroMatch = readme.match(
    /<!-- BEGIN:HERO-COUNT -->\n(\d+) bundled · (\d+) public skills/
  );
  assert.ok(heroMatch, 'hero bundled/public counts should exist');
  const heroPublic = parseInt(heroMatch[2], 10);

  const summaryMatch = readme.match(/All (\d+) public skills/);
  assert.ok(summaryMatch, 'catalog summary should reference public count');
  const summaryCount = parseInt(summaryMatch[1], 10);

  assert.equal(heroPublic, summaryCount, 'hero public count and catalog summary should match');
});

// === deep-explore regression: resource-count rows must match the shipped inventory ===

test('README resource counts: Hooks row lists exactly the 6 shipped hooks', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const row = readme.split('\n').find((l) => l.startsWith('| Hooks |'));
  assert.ok(row, 'README should have a Hooks resource row');
  assert.match(row, /^\| Hooks \| 6 \|/, 'hook count must be 6');
  assert.ok(!row.includes('namespace hint'), 'namespace hint is a script, not a hook');
  const hookFiles = readdirSync(join(ROOT, 'hooks')).filter((f) => f.endsWith('.sh'));
  assert.equal(hookFiles.length, 6, `hooks/ inventory drifted: ${hookFiles.join(', ')}`);
});

test('README resource counts: Scripts row count matches top-level scripts/ inventory', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const row = readme.split('\n').find((l) => l.startsWith('| Scripts |'));
  assert.ok(row, 'README should have a Scripts resource row');
  assert.match(row, /^\| Scripts \| 21 \|/, 'script count must be 21');
  const scriptFiles = readdirSync(join(ROOT, 'scripts')).filter(
    (f) => statSync(join(ROOT, 'scripts', f)).isFile() && /\.(sh|js)$/.test(f)
  );
  assert.equal(scriptFiles.length, 21, `scripts/ inventory drifted: ${scriptFiles.join(', ')}`);
});

// === deep-explore regression: LOCALE READMEs must not drift from disk inventory ===
// The 5 locale READMEs are hand-synced (not generated) and had gone stale at
// "9 hooks (incl. namespace hint) / 13 scripts". Labels are localized, so rows
// are located by their English example signature, not by the category label.

const LOCALE_READMES = ['README.zh-TW.md', 'README.zh-CN.md', 'README.ja.md', 'README.ko.md', 'README.es.md'];

function diskCount(dir, exts) {
  return readdirSync(join(ROOT, dir)).filter(
    (f) => statSync(join(ROOT, dir, f)).isFile() && exts.some((e) => f.endsWith(e))
  ).length;
}

// A What's-included row's 3rd pipe-cell is the count: | label | N | examples |
function rowCount(row) {
  const cells = row.split('|').map((s) => s.trim());
  return parseInt(cells[2], 10);
}

const TIER_ORDER = ['fast', 'standard', 'thorough'];

// Lines as a reader would SEE them: fenced blocks, indented code and HTML comments blanked out
// (blanked, not dropped, so nothing downstream silently re-joins across a removed region).
// Without this, fencing the tier table or wrapping it in a comment removes it from the published
// document while every parity assertion below stays green — the guard would certify a table that
// no longer renders.
// CommonMark measures indentation in COLUMNS, with tab stops of 4 — so ` \t` is 4 columns and
// opens a code block, while a naive `^(?: {4}|\t)` sees neither pattern and lets it through.
function indentColumns(line) {
  let col = 0;
  for (const ch of line) {
    if (ch === ' ') col += 1;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}

// CommonMark code spans pair by delimiter RUN LENGTH: a run of N backticks is closed by the next
// run of exactly N, never by a shorter or longer one. A regex cannot express that, and getting it
// wrong fails in both directions — `` `a <!-- b`` `` is not a span (unequal runs) so its `<!--` is
// a real opener, while ``` `` x ` <!-- `` ``` is one span whose `<!--` is inert. Returns a
// same-length copy with span contents blanked, so offsets still index into the original line.
//
// KNOWN LIMIT — single line, and backslash escapes are not honoured, for different reasons.
// Cross-line spans need buffering: whether an unclosed run is a delimiter or a literal depends on
// whether a matching run appears later in the PARAGRAPH, so no carried flag can decide it.
// Backslash escapes need no lookahead at all — a left-to-right scan can check the preceding
// backslash run — they are simply out of scope. Either error shows up in the output, because the
// caller DROPS text whose `<!--` it finds in the mask and KEEPS text where it finds none:
// over-masking blanks a genuine opener, so content Markdown hides gets shown; under-masking
// exposes an inert one, so content Markdown renders gets hidden. This helper guards ordinary tier
// tables against fences, comments and indented code; it is not a conformant inline parser and must
// not be relied on as one.
function maskCodeSpans(line) {
  // UTF-16 code units throughout, because the caller indexes the RESULT with `indexOf` and the
  // ORIGINAL with `slice` — those agree only in code units. `[...line]` iterates code points, so
  // one emoji before a `<!--` shifted every later offset by one and masked the wrong span.
  const out = line.split('');
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') { i += 1; continue; }
    let n = 0;
    while (line[i + n] === '`') n += 1;
    let j = i + n;
    for (; j < line.length; ) {
      if (line[j] !== '`') { j += 1; continue; }
      let m = 0;
      while (line[j + m] === '`') m += 1;
      if (m === n) break;
      j += m;
    }
    if (j >= line.length) { i += n; continue; }   // unmatched opener — not a span at all
    for (let k = i; k < j + n; k += 1) out[k] = ' ';
    i = j + n;
  }
  return out.join('');
}

// Pure over TEXT so the adversarial shapes below can be exercised directly — reading only real
// repo files would mean every guard here is only ever tested against documents that already pass.
function renderMarkdown(text) {
  const out = [];
  let fence = null;
  let inComment = false;
  for (const raw of text.split('\n')) {
    if (fence !== null) {
      // CommonMark: a closer uses the SAME marker, at least as many of it, no info string, and at
      // most THREE columns of indentation — a four-column marker is block content, not a closer.
      // Both relaxations fail open. A bare 3-char prefix let ```` ``` ```` "close" a ```` ```` ````
      // block; trimming before matching let an indented one close any block, and in both cases a
      // table that stays hidden on the page read as rendered documentation.
      const close = indentColumns(raw) <= 3 ? /^(`{3,}|~{3,})[ \t]*$/.exec(raw.trim()) : null;
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      out.push('');
      continue;
    }
    // The ordering here is CONTEXTUAL, and one global "comments before fences" rule cannot express
    // it. An ALREADY-OPEN comment outranks everything — a fence marker inside a comment is comment
    // text. A NEW `<!--` outranks nothing: `    <!--` is an indented code block and `` `<!--` `` is
    // a code span, and CommonMark sees no comment in either.
    let line = raw;
    let reopened = false;
    if (inComment) {
      const end = line.indexOf('-->');
      if (end === -1) { out.push(''); continue; }
      inComment = false;
      // The line's indentation belonged to the comment, so the remainder is inline content and the
      // indented-code test below does not apply to it.
      line = line.slice(end + 3);
      reopened = true;
    }
    if (!reopened && indentColumns(line) >= 4) { out.push(''); continue; }   // indented code block
    // Before the comment scan: an info string may itself contain `<!--`, and treating that as an
    // opener swallowed everything after the block instead of just the block. A BACKTICK fence may
    // not carry a backtick in its info string (a tilde fence may) — such a line is ordinary text,
    // so it falls through to the comment scan rather than opening a block that never closes.
    const fenceOpen = /^(`{3,}|~{3,})(.*)$/.exec(line.trim());
    if (!reopened && fenceOpen && !(fenceOpen[1][0] === '`' && fenceOpen[2].includes('`'))) {
      fence = { char: fenceOpen[1][0], len: fenceOpen[1].length };
      out.push('');
      continue;
    }
    const masked = maskCodeSpans(line);
    let kept = '';
    for (let i = 0; ;) {
      const open = masked.indexOf('<!--', i);
      if (open === -1) { kept += line.slice(i); break; }
      kept += line.slice(i, open);
      const close = masked.indexOf('-->', open + 4);
      if (close === -1) { inComment = true; break; }   // runs on to a later line
      i = close + 3;                                   // opened and closed within this line
    }
    line = kept;

    if (!line.trim()) { out.push(''); continue; }
    out.push(line);
  }
  return out;
}

const renderedLines = (file) => renderMarkdown(readFileSync(join(ROOT, file), 'utf8'));

function tableCells(line) {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  return t.slice(1, -1).split('|').map((c) => c.trim());
}

// Tier-table round caps, keyed by tier name.
//
// Scanning the whole file for anything that *looks like* a tier row is not enough: scattering the
// three rows among unrelated content, or dropping the header and separator entirely, still yields
// a complete oracle. So the table is located STRUCTURALLY — the 4-column header whose first cell
// is the untranslated `Tier` — and then read as one contiguous block with a fixed row order.
//
// Locating by heading name would not survive the locale mirrors, whose headings and columns 2-4
// are all translated; `Tier` is the one cell that is not. The 3-column Sub-Threshold table in
// auto-loop.md shares that first cell and is excluded here by header arity — the intended reason,
// not luck. Requiring the header also stops a future unrelated 4-column table that happens to
// mention a tier name from being picked up at all.
function tierCapsOf(file) {
  const lines = renderedLines(file);
  const heads = lines
    .map((l, i) => [tableCells(l), i])
    .filter(([c]) => c && c.length === 4 && c[0] === 'Tier')
    .map(([, i]) => i);

  assert.equal(heads.length, 1,
    `${file}: expected exactly one 4-column \`Tier\` table header, found ${heads.length}`);
  const head = heads[0];

  const sep = tableCells(lines[head + 1]);
  assert.ok(sep && sep.length === 4 && sep.every((c) => /^:?-{3,}:?$/.test(c)),
    `${file}: the \`Tier\` header is not followed by a 4-column separator row`);

  // Stop at the first non-table line — that is what makes the block contiguous, so rows moved
  // apart or padded with prose fail instead of silently reassembling into a valid oracle.
  const rows = [];
  for (let j = head + 2; j < lines.length && tableCells(lines[j]); j += 1) {
    rows.push(tableCells(lines[j]));
  }

  assert.equal(rows.length, TIER_ORDER.length,
    `${file}: expected ${TIER_ORDER.length} contiguous tier rows, found ${rows.length}`);

  const out = {};
  rows.forEach((cells, k) => {
    const want = TIER_ORDER[k];
    assert.equal(cells.length, 4, `${file}: tier row ${k + 1} has ${cells.length} cells, expected 4`);
    // The name cell tolerates a trailing badge — the `standard` row carries a localized
    // "(default)" inside the same cell — but the ORDER is fixed, so reordering fails.
    assert.match(cells[0], new RegExp(`^\`${want}\``),
      `${file}: tier row ${k + 1} is "${cells[0]}", expected \`${want}\` (order is fixed)`);
    assert.match(cells[3], /^\d+$/, `${file}: \`${want}\` cap cell is not a bare integer`);
    out[want] = Number(cells[3]);
  });
  return out;
}

// `rules/auto-loop.md` § Tiers is the authoritative table — the READMEs restate it. Deriving the
// oracle from a README instead would let all six drift away from the rule in one edit and still
// agree with each other, which is the failure this pins.
const TIER_ORACLE = 'rules/auto-loop.md';

// The renderer is the load-bearing half of every parity guard below: anything it wrongly reports as
// rendered is a table this suite will certify while the published page hides it. These are the
// shapes that each defeated an earlier version of it.
test('renderMarkdown hides tier rows that the published page would not show', () => {
  const ROW = '| `fast` | Docs | P0 | 3 |';
  const visible = (text) => renderMarkdown(text).some((l) => l.includes('`fast`'));

  const hidden = [
    // CommonMark counts indentation in COLUMNS with tab stops of 4, so ` \t` is 4 and opens a code
    // block. `^(?: {4}|\t)` matched neither the single space nor a leading tab, and let it through.
    [` \t${ROW}`, 'space+tab reaches column 4 — an indented code block'],
    ['  \t' + ROW, 'two spaces + tab likewise'],
    ['\t' + ROW, 'a bare leading tab'],
    ['    ' + ROW, 'four literal spaces, the obvious case'],
    // An opener need not start the line. Keying on `startsWith('<!--')` missed this entirely, so
    // the rows inside the comment counted as rendered.
    [`Introductory prose <!--\n${ROW}\n-->`, 'comment opened mid-line by trailing prose'],
    [`> quoted <!-- ${ROW} -->`, 'comment opened and closed inside one line'],
    ['```\n' + ROW + '\n```', 'plainly fenced'],
    // A closer may be indented at most 3 columns; at 4 it is block content. Matching on `trim()`
    // accepted any indentation, so an indented marker "closed" the block and exposed the rest.
    ['```\n    ```\n' + ROW + '\n```', 'a 4-column ``` is fence content, not a closer'],
    ['~~~\n\t~~~\n' + ROW + '\n~~~', 'same for tilde fences, closer indented by a tab'],
    // Unequal backtick runs are not a code span, so this `<!--` is a genuine opener. A regex mask
    // blanked it anyway and exposed the table it hides.
    ['`prefix <!-- suffix``\n' + ROW + '\n-->', 'unequal delimiter runs are not a code span'],
    ['````\n```\n' + ROW + '\n````', 'fenced by a longer marker an inner ``` cannot close'],
  ];
  for (const [text, why] of hidden) {
    assert.equal(visible(text), false, `renderMarkdown exposed a hidden tier row — ${why}`);
  }

  // Positive controls. Without these the assertions above are satisfied by a renderer that blanks
  // everything, and every parity guard downstream would fail open on an empty document.
  const shown = [
    [ROW, 'a plain row'],
    [`<!-- note --> ${ROW}`, 'content after an inline-closed comment still renders'],
    [`<!--\nhidden\n--> ${ROW}`, 'and after a multi-line comment closes on the same line'],
    ['```\nfenced\n```\n' + ROW, 'a row following a closed fence'],
    // An ALREADY-OPEN comment must resolve before fence detection: a fence marker inside a comment
    // is comment text. Checking the fence first opened a real one here, `-->` could not close it,
    // and every line after — including this row — was wrongly blanked.
    ['<!--\n```\n-->\n' + ROW, 'a fence marker inside a comment must not open a fence'],
    // …but a NEW opener must not outrank code, which is the opposite ordering. Each of these put
    // the renderer into comment state and blanked a table CommonMark shows.
    ['    <!--\n' + ROW, '`<!--` inside an indented code block is code, not an opener'],
    ['`<!--` is the opener token\n' + ROW, 'and inside a code span it is likewise not an opener'],
    ['```html <!--\nfenced\n```\n' + ROW, 'nor in a fence info string — the fence must still close'],
    // A two-backtick span may contain a lone backtick. Stopping the mask at that inner backtick
    // left the `<!--` unmasked, opened a phantom comment, and blanked this row.
    ['`` one ` <!-- two ``\n' + ROW, 'a code span may contain a shorter delimiter run'],
    // What follows a comment closer is INLINE content — it cannot start a fenced block, because it
    // is not at the start of the Markdown line. Recognising it opened a phantom fence that swallowed
    // this row. Same reason `reopened` already suppresses the indented-code test.
    ['<!--\n--> ```\n' + ROW, 'a suffix after `-->` cannot open a fence'],
    // Direct cover for the backtick-in-info-string branch: `` ```x` `` is not a fence opener, so it
    // stays ordinary text and the row after it renders. The valid ```` ```html <!-- ```` case above
    // only proves that a REAL fence outranks the comment scan.
    ['```js `x`\n' + ROW, 'a backtick fence may not carry a backtick in its info string'],
    [`   ${ROW}`, 'three spaces is still a paragraph, not a code block'],
  ];
  for (const [text, why] of shown) {
    assert.equal(visible(text), true, `renderMarkdown wrongly blanked a visible tier row — ${why}`);
  }

  // Blanked, not dropped: downstream reads rows as a CONTIGUOUS block, so a removed region that
  // closed the gap would silently re-join a scattered table into a valid-looking one.
  assert.equal(renderMarkdown('a\n```\nb\n```\nc').length, 5, 'hidden lines must be blanked in place');

  // The mask must index in UTF-16 code units, because the caller pairs `indexOf` on the mask with
  // `slice` on the original. An astral character ahead of the comment shifted every later offset,
  // which matters here: README markers are `<!-- BEGIN:… -->` and READMEs carry emoji.
  assert.equal(maskCodeSpans('`😀` <!-- x -->').length, '`😀` <!-- x -->'.length,
    'the mask must be the same length as its input, counted the way slice() counts');
  assert.equal(maskCodeSpans('`😀` <!-- x -->').indexOf('<!--'), '`😀` <!-- x -->'.indexOf('<!--'),
    'and the comment must sit at the same offset in both, or the wrong span gets masked');
});

test(`${TIER_ORACLE} § Tiers is shaped as this suite's tier-cap oracle`, () => {
  assert.deepEqual(
    Object.keys(tierCapsOf(TIER_ORACLE)).sort(), ['fast', 'standard', 'thorough'],
    `${TIER_ORACLE} tier table not found or its shape changed — the parity guards below would silently pass`
  );
});

test(`README.md tier round caps match ${TIER_ORACLE}`, () => {
  assert.deepEqual(
    tierCapsOf('README.md'), tierCapsOf(TIER_ORACLE),
    `README.md tier round caps drifted from ${TIER_ORACLE}`
  );
});

for (const locale of LOCALE_READMES) {
  test(`${locale}: Hooks row count matches disk and excludes namespace hint`, () => {
    const readme = readFileSync(join(ROOT, locale), 'utf8');
    // What's-included Hooks row — identified by its English example signature.
    const row = readme
      .split('\n')
      .find((l) => l.includes('pre-edit-guard') && l.includes('auto-format'));
    assert.ok(row, `${locale} should have a What's-included Hooks row`);
    assert.equal(rowCount(row), diskCount('hooks', ['.sh']), `${locale} hook count drifted`);
    assert.ok(
      !row.includes('namespace hint'),
      `${locale}: namespace hint is a script, not a hook`
    );
  });

  test(`${locale}: Scripts row count matches disk inventory`, () => {
    const readme = readFileSync(join(ROOT, locale), 'utf8');
    const row = readme
      .split('\n')
      .find((l) => l.includes('precommit runner') && l.includes('readme-catalog'));
    assert.ok(row, `${locale} should have a What's-included Scripts row`);
    assert.equal(rowCount(row), diskCount('scripts', ['.sh', '.js']), `${locale} script count drifted`);
    // Stale phantom entries that were removed from disk long ago.
    assert.ok(!row.includes('utils (shared lib)'), `${locale}: 'utils (shared lib)' no longer exists`);
    assert.ok(!row.includes('feature-resolver'), `${locale}: 'feature-resolver' no longer exists`);
  });

  // The table row and the *prose* count are synced separately by hand — the
  // prose ("… 14 rules + N hooks") had drifted to 9 while the table said 8.
  // Match the number-then-word prose form (localized 個/个/개 hooks, フック,
  // 钩子); the "| Hooks | 8 |" table cell is word-then-number and never matches.
  test(`${locale}: prose hook count matches disk (no stale "9 hooks" drift)`, () => {
    const readme = readFileSync(join(ROOT, locale), 'utf8');
    const hooks = diskCount('hooks', ['.sh']);
    const mentions = [
      ...readme.matchAll(/(\d+)\s*(?:個|个|개)?\s*(?:hooks?|フック|钩子)/gi),
    ].map((m) => parseInt(m[1], 10));
    assert.ok(mentions.length > 0, `${locale}: expected at least one prose hook-count mention`);
    for (const n of mentions) {
      assert.equal(n, hooks, `${locale}: prose says ${n} hooks but disk has ${hooks} (stale drift)`);
    }
  });

  // Same hand-sync hazard, different row: the tier table's round caps. Raising the `thorough` cap
  // 10 → 30 updated README.md and left all five mirrors publishing the old number — found by doc
  // review, not by this suite, because nothing pinned them. Compared against the rule rather than
  // against README.md so a future cap change needs one edit at the source, not seven.
  test(`${locale}: tier table round caps match ${TIER_ORACLE}`, () => {
    assert.deepEqual(
      tierCapsOf(locale), tierCapsOf(TIER_ORACLE),
      `${locale}: tier round caps drifted from ${TIER_ORACLE}`
    );
  });
}
