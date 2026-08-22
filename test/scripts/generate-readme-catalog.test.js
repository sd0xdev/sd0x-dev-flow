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
  for (const m of MARKER_KEYS) {
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
//
// `keepFenced` selects which of two questions is being asked. A count or a claim stated inside a
// fence is not documentation the reader is being given — it is sample text — so the tier and count
// guards want it blanked. A shell command is the opposite: a fence is exactly where it belongs, and
// the only way to hide it is to comment it out. Both modes blank HTML comments and indented code;
// they differ only on fenced content, and the fence delimiters are never content in either.
function renderMarkdown(text, { keepFenced = false } = {}) {
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
      const closes = close && close[1][0] === fence.char && close[1].length >= fence.len;
      if (closes) fence = null;
      out.push(keepFenced && !closes ? raw : '');
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

// The prose hook count, as a reachable verdict. Round 25 found this region wired to the equality
// check but NOT to the sign check, which made "every count-bearing region is guarded" false: the
// reader below starts at the digit, so `-6 個 hooks` parses as 6, equals disk, and publishes a
// negative count green.
const PROSE_HOOKS = /(\d+)\s*(?:個|个|개)?\s*(?:hooks?|フック|钩子)/gi;

// The two regions are defined with the two questions they serve — `proseCountRegion` (source line,
// stops at the count) and `proseCountBlock` (paragraph, rendered) — beside the checks themselves.
function assertProseHookCount(readme, where, hooks) {
  const mentions = [...readme.matchAll(PROSE_HOOKS)];
  assert.ok(mentions.length > 0, `${where}: expected at least one prose hook-count mention`);
  for (const m of mentions) {
    assert.equal(parseInt(m[1], 10), hooks,
      `${where}: prose says ${m[1]} hooks but disk has ${hooks} (stale drift)`);
    const end = m.index + m[0].length;
    const region = proseCountBlock(readme, m.index, end);
    assert.equal(offendingSign(region, renderInline(proseCountBlock(readme, m.index, end))), null,
      `${where}: the prose hook count publishes a signed number: ${JSON.stringify(region)}`);
  }
}

for (const locale of LOCALE_READMES) {
  // Both rows are addressed inside the marker block at their schema-validated positions. They
  // used to be located by `.find()` over the WHOLE file on an example signature, so a decoy row
  // anywhere above the block answered for the authoritative one — which could then say anything.
  test(`${locale}: Hooks row count matches disk and excludes namespace hint`, () => {
    const text = readFileSync(join(ROOT, locale), 'utf8');
    const cells = includedResourceRow(text, locale, 'hooks');
    assert.equal(includedResourceCount(text, locale, 'hooks'), diskCount('hooks', ['.sh']), `${locale} hook count drifted`);
    assert.ok(cells[2].includes('pre-edit-guard'), `${locale}: the Hooks row lost its example signature`);
    assert.ok(!cells[2].includes('namespace hint'), `${locale}: namespace hint is a script, not a hook`);
  });

  test(`${locale}: Scripts row count matches disk inventory`, () => {
    const text = readFileSync(join(ROOT, locale), 'utf8');
    const cells = includedResourceRow(text, locale, 'scripts');
    assert.equal(includedResourceCount(text, locale, 'scripts'), diskCount('scripts', ['.sh', '.js']), `${locale} script count drifted`);
    assert.ok(cells[2].includes('precommit runner'), `${locale}: the Scripts row lost its example signature`);
    // Stale phantom entries that were removed from disk long ago.
    assert.ok(!cells[2].includes('utils (shared lib)'), `${locale}: 'utils (shared lib)' no longer exists`);
    assert.ok(!cells[2].includes('feature-resolver'), `${locale}: 'feature-resolver' no longer exists`);
  });

  // The table row and the *prose* count are synced separately by hand — the
  // prose ("… 14 rules + N hooks") had drifted to 9 while the table said 8.
  // Match the number-then-word prose form (localized 個/个/개 hooks, フック,
  // 钩子); the "| Hooks | 8 |" table cell is word-then-number and never matches.
  // Extracted into `assertProseHookCount` rather than left inline: an inline verdict cannot be
  // reached by a synthetic control, and round 20 established that an unreachable branch is an
  // unprotected one. The control lives beside the other sign controls below.
  test(`${locale}: prose hook count matches disk (no stale "9 hooks" drift)`, () => {
    assertProseHookCount(readFileSync(join(ROOT, locale), 'utf8'), locale, diskCount('hooks', ['.sh']));
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

// === Locale fact parity: the five hand-synced mirrors against the derived facts ===
// README.md is written by `scripts/generate-readme-catalog.js`; the five locale files carry the
// same five marker blocks and no generator writes any of them. Every number in them is a hand
// edit, which is how they reached "96 bundled" while README.md said 99 — three skills shipped,
// one file was regenerated, and nothing compared the other five. Each guard below compares the
// published number against a *derived* oracle (the catalog, the git-tracked skill set, the
// frontmatter on disk) rather than a literal, so shipping a skill needs no edit here.

const ALL_READMES = ['README.md', ...LOCALE_READMES];
const MARKER_LINE = /^<!--\s*(BEGIN|END):[\w-]+\s*-->$/;
const MARKER_KEYS = ['HERO-COUNT', 'WHATS-INCLUDED-COUNT', 'INSTALL-COVERAGE', 'ESSENTIAL-SKILLS', 'FULL-CATALOG'];

// The block is LOCATED in the source (its delimiters are HTML comments by design — that is what
// makes them invisible markers) and then READ as the page renders it. Reading the source would
// certify facts no reader can see: wrapping a block's interior in one `<!--` … `-->`, or fencing
// it, leaves every regex below green over a document that publishes nothing. `renderMarkdown`
// blanks lines rather than dropping them, so the two indexings stay aligned — asserted, not
// assumed, because a future edit that made it drop lines would silently shift every slice.
function visibleMarkerBlockIn(text, key, where) {
  const raw = text.split('\n');
  // Exactly one pair, not the first pair. A second complete block renders — its delimiters are
  // comments, its content is not — so a duplicate publishes contradictory facts under the same
  // marker while a `findIndex` guard certifies only the copy that happens to come first.
  const at = (marker) => raw.reduce((acc, l, i) => (l.trim() === marker ? [...acc, i] : acc), []);
  const begins = at(`<!-- BEGIN:${key} -->`);
  const ends = at(`<!-- END:${key} -->`);
  assert.deepEqual(
    [begins.length, ends.length],
    [1, 1],
    `${where} must carry exactly one <!-- BEGIN:${key} --> … <!-- END:${key} --> pair, found ${begins.length} BEGIN / ${ends.length} END`
  );
  const [begin] = begins;
  const [end] = ends;
  assert.ok(end > begin, `${where}: <!-- END:${key} --> precedes its BEGIN`);
  // Per-key uniqueness still admits interleaving: `BEGIN A … BEGIN B … END A … END B` gives every
  // key one well-ordered pair while A's slice silently contains B's opener and B's slice contains
  // contradictory content nobody compares.
  const inner = raw.slice(begin + 1, end).findIndex((l) => MARKER_LINE.test(l.trim()));
  assert.equal(
    inner,
    -1,
    `${where}: a foreign marker opens inside the ${key} block at line ${begin + 2 + inner}`
  );
  const rendered = renderMarkdown(text);
  assert.equal(rendered.length, raw.length, 'renderMarkdown must stay line-aligned with its input');
  return rendered.slice(begin + 1, end).join('\n');
}

function visibleMarkerBlock(file, key) {
  return visibleMarkerBlockIn(readFileSync(join(ROOT, file), 'utf8'), key, file);
}

// The hero line keeps its three nouns in English in every locale (only the trailing clause is
// translated), so one shape serves all six. A locale that translates them fails here rather than
// silently reporting zero matches.
function heroCounts(file) {
  return heroCountsIn(visibleMarkerBlock(file, 'HERO-COUNT'), file);
}

// The three extractors below are the decision the guards make, and the synthetic controls call
// exactly these — not a private copy of the same regex. A fixture holding its own copy proves the
// copy works and stays green when the production caller reverts to `.match()`, which is the
// Guards-rule failure mode the controls exist to prevent.
//
// Exactly one hero claim, not the first of several: a stale line left above a corrected one is
// rendered, contradictory, and invisible to a `.match()` that stops at the first hit.
// Both read the RENDERED prose. Matching the raw source let a second claim hide behind emphasis —
// `777 public **skills**` is one contiguous noun to a reader and two tokens to the regex, so
// `soleMatch` counted one claim over a block that visibly published two.
function heroCountsIn(block, where) {
  const m = soleMatch(renderInline(block), /(\d+) bundled · (\d+) public skills · (\d+) agents/g, where, 'HERO-COUNT claim');
  return { bundled: Number(m[1]), publicSkills: Number(m[2]), agents: Number(m[3]) };
}

function catalogSummaryCountIn(block, where) {
  // Bound to the untranslated noun, with room for the locale's counter word between them:
  // `<summary>99 categories; 777 public skills</summary>` used to answer 99. A count this shape
  // cannot read is a thrown `soleMatch`, and a stray number it reads past is UNEXPECTED_INTEGERS.
  const summary = soleMatch(renderInline(block), /<summary>([^<]*)<\/summary>/g, where, '<summary>')[1];
  return Number(soleMatch(summary, new RegExp(`(\\d+)${COUNT_ADJACENT}public skills`, 'gu'), where, '<summary> public-skills count')[1]);
}

// Identity comes from the cells that do NOT carry the claim — the row number and the mechanism
// cell. Identifying the row by "some cell mentions allowed-tools" let a decoy row publishing the
// correct ratio become the tool-gating row while row 5 quietly published a wrong one.
function toolGatingClaimIn(text, where) {
  // Uniqueness is asserted on the row NUMBER alone — the authoritative identity — and the
  // mechanism signature is then checked on the row that identity selected. Requiring the
  // conjunction instead let a second row numbered 5 take over by being the only one that still
  // mentioned `allowed-tools`, while the real row 5 published a wrong ratio.
  // Arity is asserted AFTER identity, never inside it. Folded into the predicate, a malformed
  // row 5 stops being row 5 at all and a well-formed shadow inherits the name — the authoritative
  // row disappears instead of failing.
  const cells = uniqueRow(text, where, 'harness row 5', (c) => c[0] === '5');
  assert.equal(
    cells.length,
    TOOL_GATING_COLUMNS,
    `${where}: harness row 5 should publish ${TOOL_GATING_COLUMNS} cells, got ${cells.length}`
  );
  assert.ok(
    cells[2].includes('allowed-tools'),
    `${where}: harness row 5 no longer names \`allowed-tools\` as its mechanism — got "${cells[2]}"`
  );
  // Same representation and the same sign refusal as the count blocks. This cell was left on raw
  // `\d+` with no sign clause at all, so `-90 of 99 public skills` published a negative ratio and
  // parsed as `[90, 99]` — a claim contradicting itself, green.
  const rawRatioCell = cells[TOOL_GATING_COLUMNS - 1];
  const ratioSign = offendingSign(rawRatioCell, renderInline(rawRatioCell));
  assert.equal(
    ratioSign,
    null,
    `${where}: the tool-gating claim publishes a signed number — a ratio has none: ${JSON.stringify(ratioSign)}`
  );
  const ratioCell = renderInline(rawRatioCell);
  const nums = (ratioCell.match(/\d+/g) || []).map(Number);
  assert.equal(nums.length, 2, `${where}: the tool-gating claim should carry exactly two numbers, got [${nums}]`);
  // Sorting normalized `99 of 90` into a valid-looking pair. The two orders below are the two the
  // six documents actually use, so direction is read rather than discarded.
  const [a, b] = nums;
  return TOOL_RATIO_TOTAL_FIRST.has(where) ? { total: a, declaring: b } : { declaring: a, total: b };
}

// Sections in published order, each with its command rows in published order. A flat SET was the
// first shape here and it could not see the defect it was written for: moving `/adr` from
// Documentation & Tooling into Planning changes no command name and no total, so the set matched
// while both categories were wrong. Order and multiplicity are what carry taxonomy and duplicates.
function catalogSectionsIn(file) {
  return commandTableSections(visibleMarkerBlock(file, 'FULL-CATALOG'), file, 'catalog');
}

// Every data row is claimed, none skipped. Matching only rows that look like commands made an
// unparsed row invisible rather than wrong: `| /invented-skill | Not in the catalog |` rendered as
// a catalog entry and was compared against nothing. The first two rows under a heading are the
// header and its separator; everything after them must name a command.
function commandTableSections(blockText, where, what) {
  const sections = [];
  let rows = 0;
  let columns = 0;
  for (const line of blockText.split('\n')) {
    if (/^### /.test(line)) {
      sections.push({ heading: line, commands: [] });
      rows = 0;
      columns = 0;
      continue;
    }
    const cells = tableCells(line);
    if (!cells) continue;
    rows += 1;
    if (rows === 1) {
      assert.ok(
        cells.every((c) => c && !/^`\//.test(c)),
        `${where}: the first row under "${sections[sections.length - 1].heading}" is not a header — got ${JSON.stringify(cells)}`
      );
      columns = cells.length;
      continue;
    }
    // GFM requires the delimiter row to carry the same number of cells as the header; a shorter
    // one is not the table this parser believes it is reading, and every cell still matches the
    // per-cell syntax on its own.
    assert.equal(
      cells.length,
      columns,
      `${where}: a row under "${sections[sections.length - 1].heading}" publishes ${cells.length} cells against a ${columns}-cell header`
    );
    if (rows === 2) {
      // Assert the delimiter rather than assume it. Replacing it with a command row let that row
      // be skipped as "row two" while the table stopped rendering as a table at all.
      assert.ok(
        cells.every((c) => /^:?-+:?$/.test(c)),
        `${where}: the second row under "${sections[sections.length - 1].heading}" is not a delimiter row — got ${JSON.stringify(cells)}`
      );
      continue;
    }
    assert.ok(sections.length, `${where}: a ${what} row appears before any ### heading`);
    const cmd = /^`\/([a-z0-9-]+)`$/.exec(cells[0]);
    assert.ok(
      cmd,
      `${where}: ${what} row under "${sections[sections.length - 1].heading}" opens with ${JSON.stringify(cells[0])}, which is not a command — a row the parser skips is a row nobody compares`
    );
    sections[sections.length - 1].commands.push(cmd[1]);
  }
  return sections;
}

// The ESSENTIAL-SKILLS block is one table with no ### heading, so it is given a synthetic one and
// read by the same parser — same refusal to skip a row it cannot parse.
function essentialCommandsIn(file) {
  const block = visibleMarkerBlock(file, 'ESSENTIAL-SKILLS');
  const [section] = commandTableSections(`### Essential\n${block}`, file, 'essential-skills');
  assert.ok(section, `${file}: the ESSENTIAL-SKILLS block publishes no table`);
  return section.commands;
}

// Oracle: the catalog's featured entries, in catalog order — the same input the generator writes
// README.md's block from, so a locale is compared against the source, not against another mirror.
function featuredCatalogCommands() {
  return readFileSync(CATALOG_PATH, 'utf8')
    .split(/\n\s{2}- command:/)
    .slice(1)
    // `featured && public !== false`, the generator's own rule: a featured-but-private entry is
    // absent from the published table, so an oracle that included it would fail a correct README.
    .filter((entry) => entry.includes('featured: true') && !/\n\s+public:\s*false/.test(entry))
    .map((entry) => {
      const m = /^\s*\/([a-z0-9-]+)/.exec(entry);
      assert.ok(m, 'skill-catalog.yml: a featured entry has no parsable command');
      return m[1];
    });
}

function catalogCommandsIn(file) {
  return catalogSectionsIn(file).flatMap((s) => s.commands);
}

// Deliberately NOT the generator's own parser: an oracle sharing the parser under test cannot
// catch a parser bug, because both sides would be wrong in the same direction. What it does share
// is the *presentation* rules — category order by `order:`, commands sorted by `localeCompare` —
// because those are the generator's rendering decisions, not the facts under test, and a different
// collation here would fail on ordering nobody claimed was wrong.
function publicCatalogSections() {
  const text = readFileSync(CATALOG_PATH, 'utf8');
  const categories = [...text.matchAll(/^\s*- id: (\S+)\s*\n\s*label: .*\n\s*order: (\d+)/gm)]
    .map((m) => ({ id: m[1], order: Number(m[2]) }))
    .sort((a, b) => a.order - b.order);
  const entries = text.slice(text.indexOf('\nskills:')).split(/\n\s*- command: /).slice(1);
  const skills = [];
  for (const entry of entries) {
    const name = entry.match(/^\/(\S+)/);
    const category = entry.match(/^\s*category:\s*(\S+)/m);
    if (!name || !category) continue;
    if (/^\s*public:\s*false\b/m.test(entry)) continue;
    skills.push({ command: name[1], category: category[1] });
  }
  return categories
    .map((c) => ({
      id: c.id,
      commands: skills
        .filter((s) => s.category === c.id)
        .map((s) => s.command)
        .sort((a, b) => `/${a}`.localeCompare(`/${b}`)),
    }))
    .filter((c) => c.commands.length);
}

function publicCatalogCommands() {
  return new Set(publicCatalogSections().flatMap((c) => c.commands));
}

// The set the plugin actually ships — git-tracked plus not-ignored, which is what the hero calls
// "bundled". `readdirSync` would count gitignored local-only skills that no install ever sees.
// The directory check is deliberately a different one from the generator's (which reads the path's
// segment count): two independent tests of the same property, so a wrong answer has to be wrong
// twice in the same direction to pass. A stray `skills/README.md` is excluded by both.
function shippingSkillDirs() {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', 'skills/'],
    { encoding: 'utf8', cwd: ROOT }
  );
  const names = new Set(out.trim().split('\n').map((p) => p.split('/')[1]).filter(Boolean));
  return new Set(
    [...names].filter((n) => existsSync(join(SKILLS_DIR, n)) && statSync(join(SKILLS_DIR, n)).isDirectory())
  );
}

function skillsDeclaringAllowedTools() {
  let n = 0;
  for (const cmd of publicCatalogCommands()) {
    const p = join(SKILLS_DIR, cmd, 'SKILL.md');
    if (!existsSync(p)) continue;
    const fm = readFileSync(p, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    if (fm && /^allowed-tools:/m.test(fm[1])) n += 1;
  }
  return n;
}

test('the public-catalog oracle parses skill-catalog.yml', () => {
  // Shape guard. Every parity test below compares a README against this set, and a parser that
  // silently returned an empty set would make the FULL-CATALOG guards report every skill as
  // "extra" — loud — but would make any future subset check pass vacuously.
  const pub = publicCatalogCommands();
  assert.ok(pub.size > 50, `catalog parse returned ${pub.size} public skills — the oracle broke`);
  assert.ok(pub.has('codex-review-fast'), 'catalog parse should include /codex-review-fast');
});

for (const file of ALL_READMES) {
  test(`${file}: HERO-COUNT numbers match the shipping set, catalog and agents on disk`, () => {
    const hero = heroCounts(file);
    assert.equal(hero.bundled, shippingSkillDirs().size, `${file}: "bundled" drifted from the shipping skill set`);
    assert.equal(hero.publicSkills, publicCatalogCommands().size, `${file}: "public skills" drifted from docs/skill-catalog.yml`);
    assert.equal(hero.agents, diskCount('agents', ['.md']), `${file}: "agents" drifted from agents/ on disk`);
  });

  // Category by category, row by row — not a flat set. Headings are translated in the five
  // mirrors, so only the command sequences are compared; the section *count* pins the taxonomy
  // shape, and each section's ordered list pins which category a skill was published under.
  test(`${file}: FULL-CATALOG publishes the public catalog, category by category`, () => {
    const listed = catalogSectionsIn(file);
    const expected = publicCatalogSections();
    assert.equal(
      listed.length,
      expected.length,
      `${file}: FULL-CATALOG has ${listed.length} categories, docs/skill-catalog.yml has ${expected.length}`
    );
    assert.deepEqual(
      listed.map((s) => s.commands),
      expected.map((s) => s.commands),
      `${file}: FULL-CATALOG drifted from docs/skill-catalog.yml (a skill under the wrong category, a duplicate row, or a missing one)`
    );
  });

  test(`${file}: FULL-CATALOG summary and category headings count their own rows`, () => {
    const block = visibleMarkerBlock(file, 'FULL-CATALOG');
    assert.equal(
      catalogSummaryCountIn(block, file),
      catalogCommandsIn(file).length,
      `${file}: the <summary> count disagrees with the rows below it`
    );

    for (const section of catalogSectionsIn(file)) {
      const declared = section.heading.match(/\((\d+)\)\s*$/);
      assert.ok(declared, `${file}: category heading "${section.heading}" carries no (N) count`);
      assert.equal(
        Number(declared[1]),
        section.commands.length,
        `${file}: "${section.heading}" declares ${declared[1]} but lists ${section.commands.length}`
      );
    }
  });

  // The tool-gating claim is a ratio in prose, and every locale words it differently: zh-TW puts
  // the total first ("98 個公開 skill 中有 89 個"), es puts the declaring count first ("89 de
  // 98"). Reading the two numbers as a sorted pair compares the fact rather than the word order,
  // which is what lets one guard cover six phrasings.
  test(`${file}: the allowed-tools claim matches the frontmatter on disk`, () => {
    // Structural like the other count guards: exactly one row makes this claim, and the claim is
    // read from the column that publishes it. Reading "the last cell" of a `.split('|')` let an
    // excess fifth cell carrying the right ratio cover a wrong fourth one.
    // Direction matters: `99 of 90` is impossible, and a sorted pair could not say so.
    assert.deepEqual(
      toolGatingClaimIn(renderedLines(file).join('\n'), file),
      { declaring: skillsDeclaringAllowedTools(), total: publicCatalogCommands().size },
      `${file}: the allowed-tools ratio drifted from the SKILL.md frontmatter on disk, or its two numbers were swapped`
    );
  });

  // `keepFenced` here and nowhere else: a shell command's home IS a fenced block, so blanking
  // fences would look for it in the one place it must not be. Comments are still blanked, which is
  // the hiding this guard has to see.
  test(`${file}: naming Codex MCP a requirement means shipping the registration command`, () => {
    const visible = renderMarkdown(readFileSync(join(ROOT, file), 'utf8'), { keepFenced: true }).join('\n');
    assert.match(visible, CODEX_REQUIREMENT, `${file}: expected the Codex MCP requirement line`);
    assert.match(
      visible,
      CODEX_REGISTRATION,
      `${file} calls Codex MCP a requirement for the review gates but never shows how to register it`
    );
  });
}

const CODEX_REQUIREMENT = /\[Codex MCP\]\(https:\/\/github\.com\/openai\/codex\)/;
// The command's own tokens, contiguous, at the start of a line (bare or after a shell prompt).
// Unanchored, `echo claude mcp add codex -- codex mcp-server` satisfied it while registering
// nothing; anchored but non-contiguous, `claude mcp add codex -- false # codex mcp-server`
// registered `false` and put the expected server name in a comment. `[ \t]` not `\s`, which spans
// newlines and would let the two halves live on different lines.
const CODEX_REGISTRATION = /^[ \t]*(?:\$[ \t]+)?claude mcp add codex[ \t]+--[ \t]+codex[ \t]+mcp-server(?=[ \t]|$)/m;

test('the Codex-registration guard reads the command, not a mention of Codex MCP', () => {
  // Negative control. Every README mentions "Codex MCP" many times — in the catalog rows, in the
  // sequence diagram, in the category heading — so a guard that matched the phrase would be green
  // on all six today and would stay green through exactly the omission it exists to catch.
  const mentionOnly = [
    '**Requirements**: Claude Code 2.1+ | [Codex MCP](https://github.com/openai/codex) (required for the review gates)',
    '| `/codex-code-review` | Code review using Codex MCP. | - |',
  ].join('\n');
  assert.match(mentionOnly, CODEX_REQUIREMENT, 'positive control: the requirement link is detected');
  assert.doesNotMatch(mentionOnly, CODEX_REGISTRATION, 'a mention of Codex MCP is not a registration command');
  assert.match(
    "claude mcp add codex -- codex mcp-server -c 'model_reasoning_effort=\"high\"'",
    CODEX_REGISTRATION,
    'positive control: the real registration command is detected'
  );
});

// Negative controls for the two extractors above. Without these the parity guards are only ever
// exercised against documents that already pass, so a regression that made either extractor read
// the raw source again would leave every test green — which is precisely the state this batch was
// written to correct. Synthetic fixtures, because the shapes cannot be produced in a real README
// without publishing a broken one.
test('visibleMarkerBlockIn reads the rendered block, not the source', () => {
  const doc = (interior) => `# Title\n\n<!-- BEGIN:HERO-COUNT -->\n${interior}\n<!-- END:HERO-COUNT -->\n`;
  const fact = '99 bundled · 99 public skills · 15 agents';

  assert.equal(visibleMarkerBlockIn(doc(fact), 'HERO-COUNT', 'fixture'), fact,
    'positive control: ordinary text inside the markers is read');
  assert.equal(visibleMarkerBlockIn(doc(`<!--\n${fact}\n-->`), 'HERO-COUNT', 'fixture').trim(), '',
    'a commented-out interior publishes nothing and must read as nothing');
  assert.equal(visibleMarkerBlockIn(doc('```\n' + fact + '\n```'), 'HERO-COUNT', 'fixture').trim(), '',
    'a fenced interior is sample text, not a published fact');
  assert.throws(() => visibleMarkerBlockIn('# Title\n', 'HERO-COUNT', 'fixture'), /found 0 BEGIN \/ 0 END/,
    'a missing marker block is an error, never an empty pass');
});

test('renderMarkdown keepFenced keeps commands in fences and still hides commented ones', () => {
  const cmd = "claude mcp add codex -- codex mcp-server -c 'model_reasoning_effort=\"high\"'";
  const fenced = '```bash\n' + cmd + '\n```';
  assert.match(renderMarkdown(fenced, { keepFenced: true }).join('\n'), CODEX_REGISTRATION,
    'positive control: a fenced command is visible to the registration guard');
  assert.doesNotMatch(renderMarkdown('<!--\n' + fenced + '\n-->', { keepFenced: true }).join('\n'), CODEX_REGISTRATION,
    'a commented-out fence publishes no command');
  assert.doesNotMatch(renderMarkdown(fenced).join('\n'), CODEX_REGISTRATION,
    'the default mode still blanks fenced content — the count guards depend on it');
});

test('the FULL-CATALOG guard sees a skill published under the wrong category', () => {
  // The defect this replaced a set-comparison for: `/adr` shipped under Planning in all five
  // locales. Same command names, same total, both category counts self-consistent — a set-based
  // or count-based guard passes. Only the per-category sequence catches it.
  const canonical = publicCatalogSections();
  assert.ok(canonical.length >= 2, 'the fixture below needs at least two categories');
  const moved = canonical.map((s) => ({ ...s, commands: [...s.commands] }));
  moved[0].commands.push(moved[moved.length - 1].commands.pop());
  assert.notDeepEqual(
    moved.map((s) => s.commands),
    canonical.map((s) => s.commands),
    'moving a skill between categories must change the compared value'
  );
  assert.equal(
    moved.flatMap((s) => s.commands).length,
    canonical.flatMap((s) => s.commands).length,
    'and the total must NOT change — that is why a count guard cannot see this'
  );
});

// The other two count-bearing blocks. The hero and the catalog were guarded first and these were
// not, which left the suite able to certify a document publishing "777 bundled skills" — verified
// by mutation, not assumed: changing a locale's INSTALL-COVERAGE and What's-Included numbers passed
// all 75 tests. Both blocks keep their nouns in English in every locale (only the labels around
// them are translated), which is what lets one shape read all six.
// Identity and uniqueness, not existence. Searching a block for "a correct-looking number" only
// proves one exists somewhere in it: a duplicated row with the stale copy first, or the phrase
// moved into a neighbouring cell, leaves the intended cell wrong and the guard green (measured —
// both shapes passed the first version of these tests). So each claim is located as EXACTLY ONE
// row, and the number is read from that row's own cell.
// Emphasis is formatting the reader never sees, so a claim is read with it removed. Inside a code
// span the same characters are literal command text, so the span is left alone — that distinction
// is the whole point, and collapsing it is what let `` `**npx skills add**` `` pass as the command.
// `_x_` is included: it is CommonMark's other spelling of the same emphasis.
// A code span opens on a run of N backticks and closes on the next run of EXACTLY N. Splitting on
// /(`+[^`]*`+)/ instead accepted `` `777 bundled _skills_`` `` as one span — unequal runs, so
// CommonMark renders it as literal text with live emphasis inside, while the split shielded that
// emphasis from normalization and the false count read as correct.
// CommonMark escapes ASCII punctuation and nothing else: `\ ` is a backslash the reader sees, not
// an escaped space, and consuming it would hand the guards a phrase the page does not publish.
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

function inlineSegments(text) {
  const out = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    // A backslash-escaped character renders as that character alone and is never a delimiter, so
    // it leaves the plain run as its own segment. Two failures otherwise, in opposite directions:
    // `\`…\`` scanned as a code span and shielded the emphasis inside it, and folding the escape
    // back into the plain text left `\*skills\*` reading as `\skills\` — a backslash the reader
    // never sees, in the middle of the noun the claim guards look for.
    if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] || '')) {
      out.push({ kind: 'plain', text: plain, content: plain });
      plain = '';
      out.push({ kind: 'escape', text: text.slice(i, i + 2), content: text[i + 1] });
      i += 2;
      continue;
    }
    if (text[i] !== '`') {
      plain += text[i];
      i += 1;
      continue;
    }
    let open = i;
    while (text[open] === '`') open += 1;
    const width = open - i;
    let close = open;
    while (close < text.length) {
      if (text[close] !== '`') {
        close += 1;
        continue;
      }
      let end = close;
      while (text[end] === '`') end += 1;
      if (end - close === width) break;
      close = end;
    }
    if (close >= text.length) {
      // Never closed at this width, so the run is literal backticks, not a delimiter.
      plain += text.slice(i, open);
      i = open;
      continue;
    }
    out.push({ kind: 'plain', text: plain, content: plain });
    plain = '';
    out.push({ kind: 'code', text: text.slice(i, close + width), content: text.slice(open, close) });
    i = close + width;
  }
  out.push({ kind: 'plain', text: plain, content: plain });
  return out;
}

// `_` is not emphasis inside a word — CommonMark prints `STOP_GUARD_MODE` and `1_5` verbatim, and
// a rule without the flanking condition read the second as the number 15 while the reader saw
// `1_5`. That is the reader-sees-X/guard-reads-Y divergence these guards exist to close, pointed
// the wrong way. `*` carries no such restriction and keeps the plain form.
const EMPHASIS_PATTERNS = [
  /\*\*(.+?)\*\*/g,
  /\*(.+?)\*/g,
  /(?<![\p{L}\p{N}_])__(.+?)__(?![\p{L}\p{N}_])/gu,
  /(?<![\p{L}\p{N}_])_(.+?)_(?![\p{L}\p{N}_])/gu,
];

// To a fixed point, because one pass leaves the inner pair of a nested run intact: CommonMark
// renders ***skills*** as bold-italic "skills", and a single pass turned it into *skills*, so the
// noun the claim guards look for was still hidden behind live emphasis.
function stripEmphasis(text) {
  let out = text;
  let previous;
  do {
    previous = out;
    for (const pattern of EMPHASIS_PATTERNS) out = out.replace(pattern, '$1');
  } while (out !== previous);
  return out;
}

// Emphasis is formatting the reader never sees, so a claim is read with it removed. Inside a code
// span the same characters are literal command text, so the span is left alone — that distinction
// is the whole point, and collapsing it is what let `` `**npx skills add**` `` pass as the command.
// `_x_` is included: it is CommonMark's other spelling of the same emphasis.
function renderInline(text) {
  // An escape contributes the character it escapes: that is what the reader sees, and emitting
  // the backslash instead put one inside the very noun the claim guards match on.
  return inlineSegments(text)
    .map((s) => {
      if (s.kind === 'plain') return stripEmphasis(s.text);
      return s.kind === 'escape' ? s.content : s.text;
    })
    .join('');
}

// The cell as ONE code span, or nothing. Deleting every backtick accepted `npx skills ad`d` (an
// unmatched delimiter inside a wrong command) and `` `npx` skills `add` `` (three fragments, not
// one copyable command). The scanner supplies the delimiter arithmetic: an anchored /^(`+)(.+)\1$/
// backtracks into its own opening run, so it read ```x`` as the command `x rather than refusing it.
function codeSpanText(cell) {
  const segments = inlineSegments(cell).filter((s) => s.text !== '');
  if (segments.length !== 1 || segments[0].kind !== 'code') return null;
  const inner = segments[0].content.trim();
  return inner === '' ? null : inner;
}

function uniqueRow(blockText, where, what, predicate) {
  const matches = blockText.split('\n').map(tableCells).filter(Boolean).filter(predicate);
  assert.equal(
    matches.length, 1,
    `${where}: expected exactly one ${what} row, found ${matches.length} — a duplicate hides which one is authoritative`
  );
  return matches[0];
}

// One row is not one claim. Row uniqueness leaves `99 bundled skills；目前誤植為 777 bundled
// skills` inside a single cell reading as correct, because a first-match read stops at the stale
// copy — the same masking that row arity was added to remove, one level down.
function soleMatch(cell, re, where, what) {
  const all = [...cell.matchAll(re)];
  assert.equal(
    all.length, 1,
    `${where}: expected exactly one ${what} in the cell, found ${all.length} — ${JSON.stringify(cell)}`
  );
  return all[0];
}

// The claim is identified by the English noun it makes, in the cell that makes it. Row labels
// cannot serve: "Plugin install" is translated in every mirror. The arity check is what pins
// "that cell" — without it, a table that gained a column would silently move the claim.
const COVERAGE_COLUMNS = 3;
// The harness table that carries the tool-gating claim: | # | property | mechanism | evidence |
const TOOL_GATING_COLUMNS = 4;
// Which number comes first in the published sentence. English and Spanish lead with the declaring
// count ("90 of 99"); the CJK and Korean locales lead with the total ("99 個公開 skill 中有 90 個").
const TOOL_RATIO_TOTAL_FIRST = new Set(['README.zh-TW.md', 'README.zh-CN.md', 'README.ja.md', 'README.ko.md']);

// Identity that cannot be derived from the fact being checked: validate the table's SHAPE, then
// address rows by position. A signature-based selector is circular — the row that publishes a
// wrong number stops being the row under test, and any decoy carrying the right words inherits
// its name. A wrong row 0 is still row 0.
// The claim shapes the guards in this file read. A header carrying one of them is publishing a
// fact, whatever it is called.
// A count sits ADJACENT to the noun it counts, modulo the locale's counter word. Nothing is
// stripped before matching, and the pattern is not widened to tolerate a gap.
//
// Three attempts tried to decide "is this digit a claim about that noun" from what sits between
// them, and each admitted the opposite defect. A bounded non-digit gap made `Claude 3 has bundled
// skills` a claim, failing a CORRECT document. Widening to whitespace-and-punctuation did the same
// for `Claude 3 — bundled skills`. Removing enclosing decoration first then normalized
// `Claude 3（bundled skills 支援）` into `Claude 3bundled skills` — inventing a claim the document
// does not make. Tightening back left the mirror image: `777つの bundled skills` and `777개의
// bundled skills` are contradictions a reader sees plainly, and no adjacency grammar spanning six
// locales' particles was going to be complete in both directions at once.
//
// So this pattern no longer carries the burden of proving uniqueness. UNEXPECTED_INTEGERS below
// carries it, by asking a question that needs no such grammar: not what a digit means, but whether
// the block was supposed to contain it at all. A shape this pattern fails to match yields zero
// hits and `soleMatch` throws — loud, which is the direction a guard should fail in.
const COUNT_ADJACENT = '\\s*(?:個|个|개|つ)?\\s*';

const CLAIM_SHAPES = [
  /\d+\s*bundled skills/,
  /\d+\s*public skills/,
  /\d+ public \(\d+ bundled\)/,
  /\d+ bundled · \d+ public skills · \d+ agents/,
];

function schemaRows(blockText, where, what, columns, dataRows) {
  // These marker blocks publish a table and nothing else, so a visible line that is not a table
  // row is a claim the table guards never see — `777 bundled skills` on its own line rendered
  // above a perfectly valid table and was simply filtered out.
  const stray = blockText.split('\n').filter((l) => l.trim() && !tableCells(l));
  assert.deepEqual(
    stray,
    [],
    `${where}: the ${what} block publishes ${stray.length} line(s) that are not part of its table: ${JSON.stringify(stray)}`
  );
  const rows = blockText.split('\n').map(tableCells).filter(Boolean);
  assert.equal(
    rows.length,
    dataRows + 2,
    `${where}: the ${what} table should publish a header, a delimiter and ${dataRows} data rows, found ${rows.length}`
  );
  const badArity = rows
    .map((c, i) => (c.length === columns ? null : `row ${i} publishes ${c.length} cells`))
    .filter(Boolean);
  assert.deepEqual(
    badArity,
    [],
    `${where}: every ${what} row must publish ${columns} cells — ${badArity.join('; ')}`
  );
  // A header names columns; a guarded claim in it is a claim wearing a header's clothes. Banning
  // every digit was broader than the defect — `前 5 個範例` is a column name, not a count — so what
  // is refused is the claim SHAPES the guards below read.
  assert.ok(
    rows[0].map(renderInline).every((c) => c && !CLAIM_SHAPES.some((re) => re.test(c)) && !/^\d+$/.test(c)),
    `${where}: the ${what} header publishes a count claim rather than naming a column — got ${JSON.stringify(rows[0])}`
  );
  assert.ok(
    rows[1].every((c) => /^:?-+:?$/.test(c)),
    `${where}: the ${what} table has no delimiter row where one must be — got ${JSON.stringify(rows[1])}`
  );
  return rows.slice(2);
}

const COVERAGE_DATA_ROWS = 3;
// Identity for the install rows, by EXACT cell value so a different method cannot inherit one by
// merely mentioning it. Row 0's method label is translated in every locale, so its identity comes
// from the tools cell instead — `Claude Code` is untranslated everywhere. Validated for all three
// rows on every read, not for the row a caller happens to select: identity checked on selection
// left row 2 unvalidated and its constant dead.
const COVERAGE_METHOD_0 = {
  default: 'Plugin install',
  'README.zh-TW.md': 'Plugin 安裝',
  'README.zh-CN.md': '插件安装',
  'README.ja.md': 'プラグインインストール',
  'README.ko.md': '플러그인 설치',
  'README.es.md': 'Instalar plugin',
};

const COVERAGE_IDENTITY = [
  { cell: 1, value: 'Claude Code', code: false },
  { cell: 0, value: 'npx skills add', code: true },
  { cell: 0, value: '$codex-setup init', code: true },
];

function coverageRows(blockText, where) {
  const rows = schemaRows(blockText, where, 'INSTALL-COVERAGE', COVERAGE_COLUMNS, COVERAGE_DATA_ROWS);
  // Row 0's tools cell is untranslated, but it alone does not say WHICH method ships the plugin:
  // `Homebrew | Claude Code | Full (…)` satisfied every other assertion. The label is translated,
  // so it is pinned, exactly as the What's-Included labels are and for the same reason.
  assert.equal(
    rows[0][0],
    COVERAGE_METHOD_0[where] || COVERAGE_METHOD_0.default,
    `${where}: INSTALL-COVERAGE row 0 is not the plugin-install method — got ${JSON.stringify(rows[0][0])}`
  );
  // Changing `` `x` `` to ``` ``x`` ``` is a formatting edit; a non-breaking space inside the
  // command, an unmatched backtick, or three separate spans are not.
  assert.deepEqual(
    COVERAGE_IDENTITY.map((id, i) => (id.code ? codeSpanText(rows[i][id.cell]) : rows[i][id.cell])),
    COVERAGE_IDENTITY.map((id) => id.value),
    `${where}: the INSTALL-COVERAGE methods are not the three this document is supposed to publish`
  );
  return rows;
}
const INCLUDED_DATA_ROWS = 5;
// The five category labels by position. Four locales keep the English identifiers; zh-CN and ja
// translate them. This is the one place a translation is pinned rather than derived — nothing on
// disk answers "what is the Japanese for Agents", and without it a document that swaps two labels
// while leaving both payloads correct reads as valid.
const INCLUDED_LABELS = {
  default: ['Skills', 'Agents', 'Hooks', 'Rules', 'Scripts'],
  'README.zh-CN.md': ['Skills', '代理', '钩子', '规则', '脚本'],
  'README.ja.md': ['スキル', 'エージェント', 'フック', 'ルール', 'スクリプト'],
};

// The whole category column, every read. Checking only the label of the row a caller asked for
// left Hooks and Scripts unvalidated — their pinned labels were dead constants, and swapping those
// two cells kept every payload attached to the wrong name.
function includedRows(blockText, where) {
  const rows = schemaRows(blockText, where, "WHAT'S-INCLUDED", COVERAGE_COLUMNS, INCLUDED_DATA_ROWS);
  assert.deepEqual(
    rows.map((c) => c[0]),
    INCLUDED_LABELS[where] || INCLUDED_LABELS.default,
    `${where}: the What's-Included category column is not the expected sequence`
  );
  return rows;
}

// Hooks and Scripts are read through THIS pair, by both the six real files and the control below.
// The expression used to sit inline in each per-locale test body, so the control re-implemented it
// and asserted against its own copy: reverting the real readers to their old whole-file `.find()`
// left all 119 tests green, including the one named for this exact regression (round 15).
const INCLUDED_RESOURCE_ROW = { hooks: 2, scripts: 4 };

function includedResourceRow(text, where, resource) {
  const row = INCLUDED_RESOURCE_ROW[resource];
  assert.ok(row !== undefined, `${where}: ${resource} is not a What's-Included resource row`);
  return includedRows(visibleMarkerBlockIn(text, 'WHATS-INCLUDED-COUNT', where), where)[row];
}

function includedResourceCount(text, where, resource) {
  return Number(renderInline(includedResourceRow(text, where, resource)[1]));
}

function installCoverageClaim(blockText, where, index, noun) {
  const cells = coverageRows(blockText, where)[index];
  const cell = renderInline(cells[COVERAGE_COLUMNS - 1]);
  assert.ok(
    cell.includes(noun),
    `${where}: coverage row ${index} no longer publishes "${noun}" — got ${JSON.stringify(cell)}`
  );
  return Number(soleMatch(cell, new RegExp(`(\\d+)${COUNT_ADJACENT}${noun}`, 'gu'), where, `"${noun}" count`)[1]);
}

// Every integer a count block publishes must be one the block was BUILT to publish. This is the
// question the adjacency rule kept getting wrong, asked in a form with no locale grammar in it: a
// generated block is assembled from a known set of counts, so an integer that is not one of them is
// drift or a contradiction — whatever noun it sits beside, and whatever punctuation, emphasis or
// counter word surrounds it. `777つの bundled skills`, `「777」`, `*777*` and `777 de bundled
// skills` all fail the same way, and none of them needed a pattern written for it.
//
// Measured across all six READMEs before this was written: HERO `{4, 15, 99, 99}`, INSTALL-COVERAGE
// `{99, 99}`, WHATS-INCLUDED `{6, 15, 15, 21, 99, 99}` — identical multisets in every locale, and
// every member a count derived below except HERO's `4`. That one is the hand-written `~4%` tail,
// pinned here as a literal because it is not derived from anything; the request record carries it
// as a deferred finding, and this constant is where a future derivation would land.
//
// FULL-CATALOG is read at its `<summary>` only. The rest of that block quotes skill descriptions,
// whose digits are prose rather than counts (`sd0x` → 0, `P0-P5` → 0 and 5, `Top 10` → 10, `v1` and
// `1Password` → 1), and its category headings are already compared row by row above.
const HERO_CONTEXT_PERCENT = 4;

// Numerals as the READER sees them, and in both directions: a numeral the reader sees must not slip
// past, and a digit the reader never sees must not be counted against the block.
//
// Outside ASCII the answer is refusal, not normalization. `７７７` and `٧٧٧` are numbers to anyone
// looking at the page and no match at all for `/\d+/`, so contradicting counts written in them were
// published and unseen. Folding each family to ASCII would mean getting a numeric value right for
// every decimal script Unicode defines; refusing is one predicate that cannot be wrong about a
// value. Measured cost across the six READMEs and all four count-bearing regions: zero non-ASCII
// decimal digits, zero CJK numerals, zero signs, zero link destinations — so nothing legitimate is
// refused today, and a future edit that trips one of these fails loudly instead of publishing.
//
// Where this stops, stated rather than implied: numbers spelled as WORDS are out of scope and stay
// out. "seven hundred", 「칠백」 and 七百七十七 are the same case — the characters spelling them are
// ordinary vocabulary, so refusing them refuses the prose these blocks are written in. A Han set was
// tried and removed for exactly that: `一` is a numeral in 七百七十七 and a morpheme in 統一配置, and
// no enumeration of characters can tell those apart. Enumerating also could not be complete —
// `〇` and `廿` are reader-visible numerals outside both the set and `\p{Nd}`. That is the same
// undecidable question rounds 17–19 lost four times, asked about characters instead of adjacency;
// the answer is to leave it outside the boundary rather than to approximate it again.
//
// `\p{Nd}` carries no such ambiguity: a Unicode decimal DIGIT is a digit in every context, so
// refusing it is a decision about the character and not about how a locale is using it. That is
// also the exact extent of the claim — `Nd`, not every numeral Unicode knows. Category `No`
// (superscript `⁷⁷⁷`, circled `⑦`) is outside it and is logged as a deferred finding rather than
// silently implied to be covered.
const NON_ASCII_DIGIT = /(?![0-9])\p{Nd}/u;
// Mathematical signs only: ASCII, Unicode minus, full-width and small forms. En and em dashes are
// deliberately absent — the hero line every README ships publishes `— ~4%`, so a class that
// swallowed them would refuse all six on their correct shape.

// TWO QUESTIONS, NOT ONE, and neither subsumes the other:
//
//   A. Does this region use a sign in a SHAPE this corpus never uses?   (asked of the source)
//   B. Does the NUMBER a reader sees carry a sign?                      (asked of the rendered text)
//
// A is blind to a soft line break — the source line it reads is not what the reader reads. B is
// blind to a wrapper — a code span stays literal by design, so a backtick lands where B looks for a
// sign. Each blind spot has a committed escape as its control. Why seven rounds were spent
// discovering this, and which escape retired which rule, is in
// docs/features/readme-catalog-sync/requests/2026-07-30-locale-count-generation.md § Round 28.

// A: the shape question. Every legitimate sign in all six READMEs belongs to one of two CONSTRUCTS
// — and "construct", not "neighbourhood", is the distinction: allowing a sign whenever it merely
// TOUCHES what a legitimate use touches admitted `|-99`, `--99` and `（ + 99`.
//
//   W-W     hyphenated identifiers — `auto-loop`. Both neighbours must be VISIBLE word characters:
//           U+3164 HANGUL FILLER is `\p{L}` by category and invisible in fact.
//   ` + `   a spaced plus as a conjunction — `15 條 rules + 6 個 hooks`. Both sides must carry an
//           operand; `（ + 99` has an opening bracket and is refused.
//
// A third construct — the hyphen run in a table separator row — was deleted rather than tightened,
// because a data cell can wear its costume at character level. The whole LINE is skipped instead.
const SIGN_CHARS = /[-−－﹣+＋﹢]/gu;
// The same class without `g`. A global regex carries `lastIndex` across `.test()` calls, so a
// single-character test written against `SIGN_CHARS` answers true, then false, then true — which
// silently skipped every second candidate until a two-case control caught it.
const SIGN_CHAR = /[-−－﹣+＋﹢]/u;
// The skip requires a `|`. Without it a bare `-` line is delimiter-SHAPED but delimits nothing, and
// skipping it hands the next line's count a sign the reader still sees across the soft break. Every
// real delimiter row in the six READMEs carries one — `perl -ne 'print "$ARGV:$.\n" if /^\s*[-: ]*-[-: ]*\s*$/' README*.md`
// exits 0 with no output, which is an empty result rather than an error. (`grep -nP` was written here
// first and is not portable: stock macOS `/usr/bin/grep` rejects `-P`, so "returns nothing" would have
// been a failed command dressed as a measurement.) Requiring it costs the corpus nothing.
const DELIMITER_ROW = /^\s*\|[\s|:-]*-[\s|:-]*\|?\s*$|^\s*[\s:-]*-[\s:-]*\|\s*$/;

function offendingSignShape(text) {
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n];
    // A delimiter row is the SECOND line of a table, so it has a header row above it. Requiring one
    // is not an extra condition bolted on — it is what makes the line a delimiter rather than a line
    // shaped like one, and `<summary>全部` above a `|-` is exactly the difference. Measured: every
    // delimiter row in the six READMEs is preceded by a line containing `|`.
    if (DELIMITER_ROW.test(line) && n > 0 && lines[n - 1].includes('|')) continue;
    for (const m of line.matchAll(SIGN_CHARS)) {
      const i = m.index;
      const before = cpBefore(line, i);
      const after = cpAfter(line, i + 1);
      if (isVisibleWordChar(before) && isVisibleWordChar(after)
          && identifierSign(m[0], before, after)) continue;
      if (m[0] === '+' && before === ' ' && after === ' '
          && isVisibleWordChar(cpBefore(line, i - 1)) && isVisibleWordChar(cpAfter(line, i + 2))) continue;
      // A sign attached to the RIGHT of a number is a TRAILING sign, and this guard says two lines
      // down that it deliberately does not check those — `Node.js 18+` and `Claude Code 2.1+` are on
      // line 53 of all six READMEs. Once the shape question started reading the whole paragraph
      // instead of the count's own line, that declared boundary stopped holding: a legitimate
      // `Requires Node.js 18+` soft-wrapped above the hook count was refused, which is the expensive
      // direction — a false positive breaks an edit that was correct. Widening the scope without
      // re-stating the boundary in it is the defect; this line is the boundary, restated where the
      // scope now is.
      // Restricted to what the corpus publishes, not to "any sign after a digit": ASCII `+`, digit
      // on the left, whitespace or end-of-line on the right. The unrestricted form skipped the sign
      // before looking at what followed it, so `0−**6 hooks**` and `2026-\n`6 hooks`` walked out
      // through a wrapper on the right — a surface this allowance itself opened.
      if (m[0] === '+' && /\d/.test(before ?? '') && (after === undefined || /\s/.test(after))) continue;
      return line.slice(Math.max(0, i - 12), i + 12);
    }
  }
  return null;
}

// ---- B: the number question, over the rendered text ----
//
// A number has no seam. It starts where it starts, so read leftwards from it across whitespace —
// THE NEWLINE INCLUDED, which is precisely what the renderer does with a soft break — to the first
// character that is not a space. If it is not a sign, this number carries none. If it is, the same
// two constructs decide, judged from the sign's far side. A spaced `-` is refused outright: no line
// in this corpus subtracts, which is what makes `全部 - 99` an offence rather than a dash.
//
// Deliberately NOT checked: a sign AFTER a number. `Node.js 18+` is a real string in these
// documents, so a trailing-sign rule would refuse the corpus on its correct shape.
// All whitespace, not a hand-listed subset: a NO-BREAK SPACE between the sign and its digits stopped
// the walk while the reader saw them adjacent. `\s` already covers U+00A0 and the line separators.
const SIGN_SPACE = /\s/u;

function offendingSignOnNumber(visible) {
  for (const m of visible.matchAll(/\d+/g)) {
    let j = m.index - 1;
    while (j >= 0 && SIGN_SPACE.test(visible[j])) j -= 1;
    if (j < 0 || !SIGN_CHAR.test(visible[j])) continue;
    const attached = j === m.index - 1;
    let k = j - 1;
    if (!attached) while (k >= 0 && SIGN_SPACE.test(visible[k])) k -= 1;
    const beyond = k < 0 ? undefined : cpBefore(visible, k + 1);
    if (attached && isVisibleWordChar(beyond) && identifierSign(visible[j], beyond, m[0][0])) continue;
    if (!attached && visible[j] === '+' && isVisibleWordChar(beyond)) continue;
    return visible.slice(Math.max(0, j - 12), m.index + m[0].length);
  }
  return null;
}

// HTML spells these same seven characters a second way, and neither question could read it: the
// source carries `&minus;` and `renderInline` does not decode references, so `&minus;99` published a
// negative count green. This is a CLOSED list — it is the same seven characters, in HTML's spelling,
// not a new class of thing to chase. A reference that decodes to anything else is left alone.
const SIGN_REF = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(minus|plus));/g;
function decodeSignRefs(text) {
  return text.replace(SIGN_REF, (whole, dec, hex, name) => {
    const cp = name ? (name === 'minus' ? 0x2212 : 0x2b) : parseInt(dec ?? hex, dec ? 10 : 16);
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole;
    const ch = String.fromCodePoint(cp);
    return SIGN_CHAR.test(ch) ? ch : whole;
  });
}

// The verdict both callers use: either question answering "yes" is an offence.
function offendingSign(raw, visible) {
  return offendingSignShape(decodeSignRefs(raw)) ?? offendingSignOnNumber(decodeSignRefs(visible));
}

// Neighbours are read as CODE POINTS, not UTF-16 code units: an astral letter arrives as a lone
// surrogate that matches no property, which would refuse a legitimate hyphenated word. Marks count
// as word characters so a decomposed spelling reads like its composed one — NFD `café-99` puts
// U+0301 COMBINING ACUTE on the far side of the hyphen, and `\p{L}` alone would refuse it while the
// NFC spelling of the same word passes.
const cpBefore = (text, i) => (i <= 0 ? undefined : String.fromCodePoint(text.codePointAt(text.charCodeAt(i - 1) >= 0xdc00 && text.charCodeAt(i - 1) <= 0xdfff && i >= 2 ? i - 2 : i - 1)));
const cpAfter = (text, i) => (i >= text.length ? undefined : String.fromCodePoint(text.codePointAt(i)));
// A `\p{Default_Ignorable_Code_Point}` exclusion used to hang off this predicate, to stop U+3164
// HANGUL FILLER from dressing `-99` as a hyphenated identifier. `identifierSign` below now refuses
// that same escape on a stronger ground — the left side of a hyphen-then-digits must be ASCII —
// and branch-deletion showed the exclusion had no case left that depended on it. Removed rather
// than given a test written to keep it alive: the escape control for U+3164 is still red.
const isVisibleWordChar = (c) => c !== undefined && /[\p{L}\p{N}\p{M}]/u.test(c);

// Word characters on both sides is not enough on its own, and two measured shapes say why.
//
//   `正+99`  a PLUS between two word characters took the hyphenated-identifier allowance, which
//            documents hyphens. A plus followed by a digit is a sign; `Claude+Codex` — a real row in
//            all six documents — is a plus followed by a letter, and stays allowed.
//   `負-99`  a hyphen with word characters on both sides, but the left one is a CJK character, so it
//            is a negative number in a sentence rather than an identifier. Measured: nothing in the
//            six READMEs puts a non-ASCII character immediately before a hyphen-then-digits
//            (`perl -ne 'print "$&\n" while /(?<=[^\x00-\x7F])-\d+/g' README*.md` prints nothing —
//            `grep -oP` is not portable, stock macOS grep rejects `-P`), while `2-3`, `6-08` and
//            `claude-haiku-4-5` all put an ASCII one there. The far side is deliberately NOT
//            constrained — `4-시그널` in the Korean README is a hyphen followed by Hangul.
//
// A conservative refusal this leaves: `café-99` in NFD spelling. No README writes one, and it fails
// loudly rather than silently. Logged as a deferred finding.
const ASCII_IDENT = /[A-Za-z0-9_]/;
const identifierSign = (sign, before, after) =>
  /\d/.test(after) ? (sign !== '+' && sign !== '＋' && sign !== '﹢' && ASCII_IDENT.test(before)) : true;

// ONE region for both questions, and merging them is a deletion: the shape question used to read
// only the source LINE the count sits on, which meant a sign one line above was invisible to A while
// a code span on the count's own line stopped B — the two blind spots composed, and both reviewers
// constructed the same escape from it independently. The line boundary existed because the sentence
// mentioning the `--lite` long flag shares the line, but that flag sits AFTER the count, so a region
// that starts at the paragraph and still stops at the count excludes it just as well.
function proseCountBlock(text, at, end) {
  // A CommonMark blank line may carry spaces or tabs, and a CRLF file separates paragraphs with
  // `\r\n\r\n`. Searching for a literal `\n\n` finds neither, so the region ran past a real
  // paragraph boundary and pulled an unrelated `-5°C` from the sentence above into the count's
  // neighbourhood — a FALSE POSITIVE on a legitimate edit, which is the expensive direction.
  let start = 0;
  const head = text.slice(0, at);
  for (const m of head.matchAll(/\n[ \t]*\r?\n/g)) start = m.index + m[0].length;
  return text.slice(start, end);
}

function blockIntegers(text) {
  return (text.match(/\d+/g) || []).map(Number).sort((a, b) => a - b);
}

// The verdict itself, shared by the per-file guards and the synthetic controls. Returning the
// multiset and letting each caller compare was not enough: the comparison stayed inline in the
// per-file test, so deleting it left every control green — they proved the extractor extracts, never
// that any README is checked against the derived counts. `rules/testing.md` § Guards names exactly
// that failure, and this file had shipped it. Assert here, and a control that expects a throw goes
// red the moment this assertion is weakened.
function assertPublishedIntegers(region, where, what, expected) {
  // The SAME representation the positional claim readers use. Reading the raw block here while
  // `installCoverageClaim`/`heroCountsIn` read `renderInline(block)` was a representation mismatch,
  // and `-**99** bundled skills` lived in the gap: emphasis vanishes for the reader and for those
  // readers, but the sign regex could not cross the `**`, so a negative count published green.
  // This is the file's own inline walker, already trusted by three other guards — not a second
  // hand-written approximation of what a reader sees, which is what round 22 correctly rejected.
  const visible = renderInline(region);
  assert.ok(
    !NON_ASCII_DIGIT.test(visible),
    `${where}: ${what} publishes a non-ASCII decimal digit — a count block has none, so this is drift or a contradiction: ${JSON.stringify(region)}`
  );
  // The sign check reads the SAME rendered text, because the question is about the number a reader
  // sees. Reading the raw region was what let `-\n99` pass: the newline is a seam in the source and
  // a space to the reader, and only one of those two is the thing being published.
  const sign = offendingSign(region, visible);
  assert.equal(
    sign,
    null,
    `${where}: ${what} publishes a signed number in a position this corpus never uses: ${JSON.stringify(sign)}`
  );
  assert.deepEqual(
    blockIntegers(visible),
    [...expected].sort((a, b) => a - b),
    `${where}: ${what} publishes an integer it was not built to publish, or lost one`
  );
}

function assertBlockIntegers(text, where, key, expected) {
  assertPublishedIntegers(visibleMarkerBlockIn(text, key, where), where, `the ${key} block`, expected);
}

// The WHOLE document's verdict, in one function, because splitting it left the WIRING unguarded:
// the controls called `assertBlockIntegers` directly, so deleting a region from the per-file test's
// map — or dropping the FULL-CATALOG summary call entirely — kept every test green. That is round
// 20's failure class narrowed by one level: from "the verdict's internals are unprotected" to
// "whether production applies the verdict to every region is unprotected". The controls below call
// THIS function against a four-region fixture, so a region that stops being checked turns one red.
function assertDocumentCounts(text, where, counts) {
  const regions = {
    'HERO-COUNT': [counts.bundled, counts.pub, counts.agents, HERO_CONTEXT_PERCENT],
    'INSTALL-COVERAGE': [counts.bundled, counts.pub],
    'WHATS-INCLUDED-COUNT': [counts.pub, counts.bundled, counts.agents, counts.hooks, counts.rules, counts.scripts],
  };
  for (const [key, nums] of Object.entries(regions)) assertBlockIntegers(text, where, key, nums);
  const summary = soleMatch(
    renderInline(visibleMarkerBlockIn(text, 'FULL-CATALOG', where)),
    /<summary>([^<]*)<\/summary>/g, where, '<summary>'
  )[1];
  assertPublishedIntegers(summary, where, 'the FULL-CATALOG <summary>', [counts.pub]);
}

// Matched against the EXAMPLE cell only, so a decoy row mentioning the same skills in its label or
// count cell cannot stand in for the real one. Examples are the identifying cell because zh-CN and
// ja translate the label (代理 / エージェント) while zh-TW, ko and es leave it English — the same
// idiom, and the same measured reason, as the Hooks and Scripts row guards above.
function whatsIncludedRow(blockText, where, index, what, ...marks) {
  const cells = includedRows(blockText, where)[index];
  assert.ok(
    marks.every((m) => cells[2].includes(m)),
    `${where}: row ${index} is not ${what}, or its examples moved out of the examples column — got ${JSON.stringify(cells[2])}`
  );
  return cells;
}

for (const file of ALL_READMES) {
  test(`${file}: the count blocks publish no integer they were not built to publish`, () => {
    assertDocumentCounts(readFileSync(join(ROOT, file), 'utf8'), file, {
      bundled: shippingSkillDirs().size,
      pub: publicCatalogCommands().size,
      agents: diskCount('agents', ['.md']),
      hooks: diskCount('hooks', ['.sh']),
      rules: diskCount('rules', ['.md']),
      scripts: diskCount('scripts', ['.sh', '.js']),
    });
  });

  test(`${file}: INSTALL-COVERAGE counts match the shipping set and the catalog`, () => {
    const block = visibleMarkerBlock(file, 'INSTALL-COVERAGE');
    assert.equal(installCoverageClaim(block, file, 0, 'bundled skills'), shippingSkillDirs().size,
      `${file}: INSTALL-COVERAGE "bundled skills" drifted`);
    assert.equal(installCoverageClaim(block, file, 1, 'public skills'), publicCatalogCommands().size,
      `${file}: INSTALL-COVERAGE "public skills" drifted`);
  });

  test(`${file}: the What's-Included Skills and Agents rows match disk`, () => {
    const block = visibleMarkerBlock(file, 'WHATS-INCLUDED-COUNT');
    const skillsCell = renderInline(whatsIncludedRow(block, file, 0, 'Skills', '/project-setup', '/deep-research')[1]);
    const agentsCell = renderInline(whatsIncludedRow(block, file, 1, 'Agents', 'strict-reviewer', 'coverage-analyst')[1]);
    const skills = soleMatch(skillsCell, /(\d+) public \((\d+) bundled\)/g, file, 'Skills count claim');
    assert.equal(Number(skills[1]), publicCatalogCommands().size, `${file}: What's Included "public" drifted`);
    assert.equal(Number(skills[2]), shippingSkillDirs().size, `${file}: What's Included "bundled" drifted`);
    assert.match(agentsCell, /^\d+$/, `${file}: the Agents count cell is not a bare number — got ${JSON.stringify(agentsCell)}`);
    assert.equal(Number(agentsCell), diskCount('agents', ['.md']), `${file}: What's Included agent count drifted`);
    assert.equal(Number(renderInline(whatsIncludedRow(block, file, 3, 'Rules', 'auto-loop-project', 'context-management')[1])), diskCount('rules', ['.md']), `${file}: What's Included rules count drifted`);
  });
}

// Fixtures for the shapes that passed earlier versions of these guards. Shared by the three
// control tests below, which are split by failure class so a red one names what broke.
// Fixtures shaped like the real blocks: three coverage rows, five What's-Included rows. A control
// built from a one-row table could not exercise positional identity at all, and the shapes below
// are the ones that passed earlier versions of these guards.
const COVERAGE_FIXTURE = (rows) => ['| Method | Tools | Coverage |', '|---|---|---|', ...rows].join('\n');
const INCLUDED_FIXTURE = (rows) => ['| Category | Count | Examples |', '|---|---|---|', ...rows].join('\n');
const COVERAGE_ROWS = [
  '| Plugin install | Claude Code | Full (99 bundled skills, hooks) |',
  '| `npx skills add` | Codex CLI | Skills only (99 public skills) |',
  '| `$codex-setup init` | Codex CLI | AGENTS.md kernel + commit-msg hook (pre-push gate opt-in) |',
];
const INCLUDED_ROWS = [
  '| Skills | 99 public (99 bundled) | `/project-setup`, `/deep-research` |',
  '| Agents | 15 | strict-reviewer, coverage-analyst |',
  '| Hooks | 6 | pre-edit-guard, auto-format |',
  '| Rules | 15 | auto-loop-project, context-management |',
  '| Scripts | 21 | precommit runner, verify runner |',
];
const withRow = (rows, i, row) => rows.map((r, k) => (k === i ? row : r));

// Both directions, per rules/testing.md § Guards. These call `assertBlockIntegers` — the function
// that carries the per-file guard's verdict — and expect it to THROW, so weakening that assertion
// turns them red. An earlier version called a helper that merely RETURNED the multiset and compared
// it here; deleting the production comparison left all of these green, because they were proving
// that the extractor extracts rather than that any README is checked against the derived counts.
const HERO_FIXTURE = (tail) => [
  '<!-- BEGIN:HERO-COUNT -->',
  `99 bundled · 99 public skills · 15 agents — ~4%${tail}`,
  '<!-- END:HERO-COUNT -->',
].join('\n');
const HERO_EXPECTED = [4, 15, 99, 99];

test('a count block refuses an integer it was not built to publish', () => {
  assert.doesNotThrow(
    () => assertBlockIntegers(HERO_FIXTURE(''), 'fixture', 'HERO-COUNT', HERO_EXPECTED),
    'negative control: the shape all six READMEs actually publish must pass'
  );
  // Every shape that defeated an adjacency rule, including the three particle forms the last
  // attempt inverted on. None of them needed a pattern written for it.
  for (const stray of [
    '（實際 777 bundled skills）',
    '; 実際は 777つの bundled skills',
    '; 실제로는 777개의 bundled skills',
    '; en realidad 777 de bundled skills',
    '; 另有 `777` bundled skills',
    '; **777** bundled skills',
  ]) {
    assert.throws(
      () => assertBlockIntegers(HERO_FIXTURE(stray), 'fixture', 'HERO-COUNT', HERO_EXPECTED),
      /was not built to publish/,
      `a contradicting count must be refused: ${stray}`
    );
  }
});

// Every numeral form the reader sees but `/\d+/` does not, each caught by the clause written for its
// family — and the one form that is NOT a published numeral, which must still pass.
test('a count block refuses a numeral the reader sees but ASCII matching misses', () => {
  for (const [tail, why] of [
    ['; 実際は ７７７ bundled skills', 'full-width digits render as a number'],
    ['; 実際は ７７７つの bundled skills', 'and a counter word after them changes nothing'],
    ['; 实际是 ٧٧٧ bundled skills', 'Arabic-Indic digits are a decimal numeral too'],
  ]) {
    assert.throws(
      () => assertBlockIntegers(HERO_FIXTURE(tail), 'fixture', 'HERO-COUNT', HERO_EXPECTED),
      /non-ASCII decimal digit/,
      why
    );
  }
  const coverage = (row) => [
    '<!-- BEGIN:INSTALL-COVERAGE -->',
    COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, row)),
    '<!-- END:INSTALL-COVERAGE -->',
  ].join('\n');
  for (const sign of ['-', '−', '－', '﹣', '+', '＋', '﹢']) {
    assert.throws(
      () => assertBlockIntegers(coverage(`| Plugin install | Claude Code | Full (${sign}99 bundled skills) |`), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
      /signed number/,
      `a signed count reads as its magnitude to \`\\d+\`, so the sign is refused on its own terms: ${sign}`
    );
  }
  // Emphasis between the sign and its digits. The reader sees `-99`; the raw source does not put
  // them adjacent, so a sign check reading the source passed a document publishing a negative count.
  for (const marked of ['-**99**', '－**99**', '-_99_', '+**99**']) {
    assert.throws(
      () => assertBlockIntegers(coverage(`| Plugin install | Claude Code | Full (${marked} bundled skills) |`), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
      /signed number/,
      `emphasis is formatting, so the sign is still attached for the reader: ${marked}`
    );
  }
  assert.doesNotThrow(
    () => assertBlockIntegers(coverage(COVERAGE_ROWS[0]), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
    'negative control: the real coverage shape carries no sign and must pass'
  );
  // The wrapper class, closed at once rather than one member at a time. Each of these puts
  // something invisible between the sign and its digits; none of them needs its own rule, because
  // the sign belongs to none of the three constructs and a `(` followed by a backtick, `[` or `<`
  // is not one this corpus uses.
  for (const wrapped of ['-`99 bundled skills`', '-[99 bundled skills](#coverage)', '-<strong>99 bundled skills</strong>', '-<!-- x -->99 bundled skills']) {
    assert.throws(
      () => assertBlockIntegers(coverage(`| Plugin install | Claude Code | Full (${wrapped}) |`), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
      /signed number/,
      `a sign separated from its digits by an invisible wrapper still publishes a signed count: ${wrapped}`
    );
  }
  // Touching what a legitimate construct touches is not being that construct. Each of these was
  // GREEN under the first version of the predicate, which allowed a sign on mere adjacency — and
  // each publishes a signed count to a reader. They are the reason the rules below judge the
  // construct (the whole hyphen run and where it sits; a conjunction's two operands; a VISIBLE
  // word character) rather than one neighbouring character.
  for (const [shape, why] of [
    ['| Plugin install | Claude Code |-99 bundled skills, hooks |', 'a `-` touching a `|` in an ordinary data cell is not a separator row'],
    ['| Plugin install | Claude Code | Full (--99 bundled skills) |', 'two adjacent hyphens are not a run inside a table'],
    ['| Plugin install | Claude Code | Full ( + 99 bundled skills) |', 'a space-flanked `+` with no left operand is a unary sign, not a conjunction'],
    ['| Plugin install | Claude Code | Full ( + `99` bundled skills) |', 'the same unary plus behind a code span, which `renderInline` keeps literal: the number walk stops at the backtick, so only the two-operand rule refuses it'],
    ['| Plugin install | Claude Code | Full (ㅤ-99 bundled skills) |', 'U+3164 HANGUL FILLER is invisible, so it cannot make `-99` a hyphenated word'],
  ]) {
    assert.throws(
      () => assertBlockIntegers(coverage(shape), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
      /signed number/,
      `${why}: ${JSON.stringify(shape)}`
    );
  }
  // The three shapes the corpus DOES use. Deleting any allowance turns one of these red, so the
  // measured list cannot quietly shrink; adding an unmeasured one has to face them too.
  for (const legit of [
    '| Plugin install | Claude Code | Full (99 bundled skills, auto-loop, pre-edit-guard) |',
    '| Plugin install | Claude Code | Full (99 bundled skills) — AGENTS.md kernel + git hooks |',
    '| Plugin install | Claude Code | Full (**99** bundled skills) |',
  ]) {
    assert.doesNotThrow(
      () => assertBlockIntegers(coverage(legit), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
      `negative control: a shape the six READMEs actually publish must pass — ${legit}`
    );
  }
  // The seam a LINE-level rule cannot see. Both of these put the sign on its own source line, where
  // it reads as a delimiter row and is skipped whole — and Markdown then collapses the soft break
  // into a space, so the reader is shown `- 99` and `- 99` all the same. The shape question is blind
  // here by construction; the number question is what refuses them.
  for (const [split, why] of [
    ['| Plugin install | Claude Code | Full (\n-\n99 bundled skills) |', 'a bare `-` line is delimiter-shaped, but the renderer puts it against the count'],
    ['| Plugin install | Claude Code | Full (\n:-\n99 bundled skills) |', 'so is `:-`, and the alignment colon changes nothing for the reader'],
  ]) {
    assert.throws(
      () => assertBlockIntegers(coverage(split), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
      /signed number/,
      `${why}: ${JSON.stringify(split)}`
    );
  }
  assert.doesNotThrow(
    () => assertBlockIntegers(coverage('| Plugin install | Claude Code | Full (99 bundled skills) |\n|---|---|---|'), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
    'negative control: a REAL delimiter row is still skipped — deleting the skip must break this, not the escapes above'
  );
  // A delimiter row is the SECOND line of a table, so a header row sits above it. Requiring one is
  // what separates a delimiter from a line merely SHAPED like one, and this fixture is the whole
  // difference: with the requirement the `|-` line is scanned and its sign refused; without it the
  // line is skipped as a delimiter, and the code span then keeps the number question from ever
  // seeing `99`. Both blind spots at once — which is how the escape was built.
  assert.throws(
    () => assertBlockIntegers('<!-- BEGIN:HERO-COUNT -->\n|-\n`99` bundled · 99 public skills · 15 agents — ~4%\n<!-- END:HERO-COUNT -->', 'fixture', 'HERO-COUNT', HERO_EXPECTED),
    /signed number/,
    'a delimiter-shaped line with no header row above it delimits nothing, so its sign is still a sign'
  );
  assert.doesNotThrow(
    () => assertBlockIntegers(HERO_FIXTURE(''), 'fixture', 'HERO-COUNT', HERO_EXPECTED),
    'negative control: the hero line every README ships writes `— ~4%`, and an em dash is not a sign'
  );
});

// The prose hook count is a count-bearing region OUTSIDE the marker blocks, and round 25 found it
// guarded for drift but not for signs. Both directions ship together, per `rules/testing.md`
// § Guards: the signed form must be refused, and the sentence the six READMEs actually publish —
// which carries a legitimate ` + ` conjunction in the same breath — must pass.
// The one branch here whose defect is statefulness rather than a wrong answer, so no fixture can
// pin it: a global regex carries `lastIndex` across `.test()` calls, and the single-character tests
// above then answer true, false, true — silently skipping every second candidate, in an order that
// depends on which other test ran first. It was found by shipping two fixtures where one would have
// looked sufficient. The property itself is what has to be asserted.
test('the single-character sign regex is stateless', () => {
  assert.equal(SIGN_CHAR.global, false, '`.test()` on a global regex advances lastIndex and skips every second candidate');
  assert.equal(SIGN_CHAR.test('-'), SIGN_CHAR.test('-'), 'the same character must answer the same way twice in a row');
});

test('the prose hook count refuses a signed number and spares the shipped sentence', () => {
  assert.throws(
    () => assertProseHookCount('完整 plugin 包含 15 條 rules + -6 個 hooks。', 'fixture', 6),
    /signed number/,
    'a negative prose hook count parses as its magnitude, so the sign must be refused on its own terms'
  );
  assert.throws(
    () => assertProseHookCount('完整 plugin 包含 15 條 rules + 9 個 hooks。', 'fixture', 6),
    /stale drift/,
    'positive control: the drift check still fires — the sign check did not replace it'
  );
  assert.doesNotThrow(
    () => assertProseHookCount('完整 plugin 包含 15 條 rules + 6 個 hooks。', 'fixture', 6),
    'negative control: the sentence all six READMEs ship must pass, conjunction and all'
  );
  assert.doesNotThrow(
    () => assertProseHookCount('4 advisory hooks plus the pre-edit-guard: 6 hooks total.', 'fixture', 6),
    'negative control: a hyphenated identifier next to the count is not a sign'
  );
  // The same seam, in prose. A soft line break splits the sign from its count in the SOURCE while
  // the paragraph the reader sees is `15 條 rules + - 6 個 hooks`. A line-bounded region hands back
  // only the second line and sees nothing.
  assert.throws(
    () => assertProseHookCount('完整 plugin 包含 15 條 rules + -\n6 個 hooks。', 'fixture', 6),
    /signed number/,
    'a Markdown soft break is whitespace to the reader, so the sign is still attached to the count'
  );
  // Known conservative refusal, stated rather than asserted: a conjunction split across a soft break
  // (`15 條 rules\n+ 6 個 hooks`) is refused, because the shape question reads the source line and
  // sees a leading `+` with no left operand. No README writes it that way — the shipped sentence is
  // one line — and asserting on a shape the corpus does not publish is how a guard stops being
  // derived from the corpus. Logged below as a deferred finding.
  // Word characters are read as CODE POINTS and marks count as word characters. Neither branch had a
  // committed control: reverting to UTF-16 indexing, or dropping `\p{M}`, left all tests green.
  assert.doesNotThrow(
    () => assertProseHookCount('astral identifier \u{1D400}-flow 有 6 個 hooks。', 'fixture', 6),
    'negative control: an astral letter beside the hyphen is one code point, not a lone surrogate'
  );
  assert.doesNotThrow(
    () => assertProseHookCount('decomposed spelling café-flow 有 6 個 hooks。', 'fixture', 6),
    'negative control: NFD `café-` puts a combining mark beside the hyphen, and spells the same word as NFC'
  );
  // Word characters on both sides is not sufficient, and both directions ship together. A sign
  // followed by DIGITS is a sign; the same character followed by a letter is punctuation in a name.
  for (const [shape, why] of [
    ['正+99 條 rules，共 6 個 hooks。', 'a plus between word characters took the hyphenated-identifier allowance, which documents hyphens'],
    ['正＋99 條 rules，共 6 個 hooks。', 'the full-width plus is the same character in another spelling'],
    ['負-99 條 rules，共 6 個 hooks。', 'a CJK character before a hyphen-then-digits is a negative number in a sentence, not an identifier'],
  ]) {
    assert.throws(() => assertProseHookCount(shape, 'fixture', 6), /signed number/, why);
  }
  for (const legit of [
    'Claude+Codex 對抗式辯論；完整 plugin 包含 6 個 hooks。',
    '스코어링 4-시그널 완전성 모델，共 6 個 hooks。',
    'v4.2.0 於 2-3 天內發佈，共 6 個 hooks。',
  ]) {
    assert.doesNotThrow(() => assertProseHookCount(legit, 'fixture', 6),
      `negative control: a shape the six READMEs actually publish must pass — ${legit}`);
  }
  // HTML spells the same seven characters a second way, and neither question read it.
  for (const ref of ['&minus;', '&#8722;', '&#x2212;', '&plus;', '&#43;']) {
    assert.throws(
      () => assertProseHookCount(`完整 plugin 包含 15 條 rules 與（${ref}6 個 hooks）。`, 'fixture', 6),
      /signed number/,
      `a character reference is the same sign in HTML's spelling: ${ref}`
    );
  }
  // The closed list is asserted directly, because the fixture here (`&amp;`) never reached the branch
  // at all — `SIGN_REF` does not match it, so the case passed for a reason unrelated to the rule it
  // claimed to protect. `&#8211;` is an EN DASH: it matches `SIGN_REF`, decodes to a real character,
  // and must come back out unchanged because an en dash is not one of the seven.
  assert.equal(decodeSignRefs('rules &#8211; hooks'), 'rules &#8211; hooks',
    'a reference that decodes to something other than the seven sign characters is left as written');
  assert.equal(decodeSignRefs('&#8722;6'), '−6', 'positive control: a reference that IS a sign is decoded');
  assert.doesNotThrow(
    () => assertProseHookCount('完整 plugin 包含 &#8211; 15 條 rules + 6 個 hooks。', 'fixture', 6),
    'negative control: an en-dash reference beside the count is not a sign'
  );
  // The closed list matters BEHAVIOURALLY, and the direction is the opposite of the obvious one. A
  // substituted non-sign cannot manufacture a sign — but it can SUPPRESS a refusal, by manufacturing
  // the context another rule skips on. `&#49;` is the digit `1`, and substituting it would satisfy
  // the trailing-sign allowance in front of a wrapped count.
  assert.throws(
    () => assertProseHookCount('&#49;-`6 個 hooks`', 'fixture', 6),
    /signed number/,
    'a digit reference must not be substituted into place to satisfy the digit-before-sign allowance'
  );
  // The false positive round 29 introduced: widening the shape question to the whole paragraph made
  // it read signs belonging to other sentences, and `Node.js 18+` is on line 53 of all six READMEs.
  // A trailing sign is one this guard says outright it does not check; the paragraph scope has to
  // carry that boundary with it.
  assert.doesNotThrow(
    () => assertProseHookCount('Requires Node.js 18+ and Claude Code 2.1+\nand includes 6 hooks.', 'fixture', 6),
    'negative control: a trailing sign in a neighbouring sentence is not a sign on the count'
  );
  // …and the allowance that carries it is restricted to the corpus construct, in BOTH directions.
  // Written as "any sign after a digit" it skipped before looking right, so a wrapper on the right
  // walked straight out. Each of these is refused only because the allowance names ASCII `+` and
  // requires whitespace or end-of-line after it.
  for (const [doc, why] of [
    ['0−**6 個 hooks**', 'a minus is not the `+` the corpus publishes, and emphasis follows it'],
    ['0−`6 個 hooks`', 'the same behind a code span'],
    ['0−[6 個 hooks](#x)', 'the same behind a link'],
    ['0−<strong>6 個 hooks</strong>', 'the same behind inline HTML'],
    ['2026-\n`6 個 hooks`', 'a hyphen after a digit, with the wrapper on the next line'],
    // The five above all use a minus, so the `+`-only half of the allowance refuses them and the
    // right-hand-side half is never consulted. This one is an ASCII `+` after a digit — everything
    // the allowance asks for except what follows it — so it is the only case that fails when the
    // whitespace-or-end-of-line requirement alone is dropped.
    ['0+`6 個 hooks`', 'an ASCII plus after a digit, but a code span rather than whitespace follows it'],
  ]) {
    assert.throws(() => assertProseHookCount(doc, 'fixture', 6), /signed number/,
      `the trailing-sign allowance must not reach past its right-hand side: ${why}`);
  }
  // A blank line may carry spaces, and a CRLF file separates paragraphs with `\r\n\r\n`. Neither is
  // a literal `\n\n`, and missing them ran the region past a real paragraph boundary.
  for (const [doc, why] of [
    ['環境可低至 -5°C。\n   \n完整 plugin 包含 6 個 hooks。', 'a blank line carrying spaces still ends the paragraph'],
    ['環境可低至 -5°C。\r\n\r\n完整 plugin 包含 6 個 hooks。', 'so does a CRLF blank line'],
  ]) {
    assert.doesNotThrow(() => assertProseHookCount(doc, 'fixture', 6), `negative control: ${why}`);
  }
  assert.throws(
    () => assertProseHookCount('環境可低至 5°C。\n-\n6 個 hooks。', 'fixture', 6),
    /signed number/,
    'positive control: a soft break inside the SAME paragraph is not a boundary'
  );
  // THE COMPOSITION. Both reviewers constructed this independently, and it is why the two regions
  // were merged: the sign sits one line above (invisible to a line-bounded shape question) and the
  // count sits inside a code span (which stops the number walk). Neither blind spot is new; the
  // finding was that they compose, and a mutation proving each question is individually necessary
  // says nothing about that.
  for (const [doc, why] of [
    ['完整 plugin 包含 15 條 rules\n:-\n`6 個 hooks`。', 'delimiter-shaped line above, code span around the count'],
    ['完整 plugin 包含 15 條 rules\n-\n`6 個 hooks`。', 'the same with a bare hyphen line'],
    ['完整 plugin 包含 15 條 rules\n-\n[6 個 hooks](#x)。', 'and with a link instead of a code span'],
  ]) {
    assert.throws(() => assertProseHookCount(doc, 'fixture', 6), /signed number/, why);
  }
  // Any FIXED-length lead-in is a number an author can pad past. Both of these were green under an
  // 8-character window: the wrapper filled it, and the sign sat one character outside. The region
  // is bounded by the line now, which has no length to exceed — so these must stay refused however
  // long the wrapper grows.
  for (const padded of [
    '15 條 rules + -````````6 個 hooks````````。',
    '15 條 rules + -<span class=abcdefgh>6 個 hooks</span>。',
    `15 條 rules + -${'<!-- '.repeat(9)}6 個 hooks。`,
  ]) {
    assert.throws(
      () => assertProseHookCount(padded, 'fixture', 6),
      /signed number/,
      `a wrapper long enough to fill a fixed window must not carry the sign out of the region: ${padded}`
    );
  }
  assert.doesNotThrow(
    () => assertProseHookCount('完整 plugin 包含 15 條 rules + 6 個 hooks。使用 `--lite` 可略過 rules 與 hooks。', 'fixture', 6),
    'negative control: a `--lite` long flag AFTER the count is not a sign on it — the five locales ship this line'
  );
});

// The boundary, pinned so that re-crossing it is a deliberate act rather than an oversight. A Han
// numeral set was added here and removed the same day: `一` is a numeral in 七百七十七 and a morpheme
// in 統一配置, and refusing the character refuses both. This test fails the moment someone reinstates
// a character-enumerating rule, and its comment is the reason why.
test('ordinary CJK prose that happens to contain a numeral character is not a count', () => {
  const prose = '| Plugin install | Claude Code | 完整（99 bundled skills，統一配置、一鍵安裝） |';
  assert.doesNotThrow(
    () => assertBlockIntegers(
      ['<!-- BEGIN:INSTALL-COVERAGE -->', COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, prose)), '<!-- END:INSTALL-COVERAGE -->'].join('\n'),
      'fixture', 'INSTALL-COVERAGE', [99, 99]
    ),
    '統一 and 一鍵 are vocabulary, not counts — a guard that refuses them blocks a correct locale edit'
  );
  // The cost of that boundary, stated rather than hidden: a count spelled in CJK numerals is NOT
  // caught, exactly as a count spelled "seven hundred" is not. `docs/features/readme-catalog-sync/
  // requests/2026-07-30-locale-count-generation.md` records it as a known limitation.
  assert.doesNotThrow(
    () => assertBlockIntegers(HERO_FIXTURE('; 実際は七百七十七 bundled skills'), 'fixture', 'HERO-COUNT', HERO_EXPECTED),
    'the limitation is deliberate: word-spelled numbers are outside what this guard decides'
  );
});

// A four-region document, so the controls can exercise the WIRING and not merely the verdict.
// Deliberately distinct sentinels: no two are equal, and none equals any real disk count. Reusing
// the repository's own numbers made this fixture INTERCHANGEABLE with a real README, which cost two
// guarantees at once. Outward: swapping `readFileSync(…)` for `DOC_FIXTURE()` in the six per-file
// tests left all six green, so not one of them proved it had read the file it is named after.
// Inward: writing `counts.bundled` where `counts.pub` belongs was invisible, because both are 99.
// Distinct values turn each of those into a red.
const DOC_COUNTS = { bundled: 101, pub: 97, agents: 13, hooks: 7, rules: 11, scripts: 23 };
const DOC_FIXTURE = (strays = {}) => [
  '<!-- BEGIN:HERO-COUNT -->',
  `101 bundled · 97 public skills · 13 agents — ~4%${strays['HERO-COUNT'] || ''}`,
  '<!-- END:HERO-COUNT -->',
  '<!-- BEGIN:INSTALL-COVERAGE -->',
  COVERAGE_FIXTURE([
    `| Plugin install | Claude Code | Full (101 bundled skills${strays['INSTALL-COVERAGE'] || ''}) |`,
    '| `npx skills add` | Codex CLI | Skills only (97 public skills) |',
    '| `$codex-setup init` | Codex CLI | AGENTS.md kernel + commit-msg hook (pre-push gate opt-in) |',
  ]),
  '<!-- END:INSTALL-COVERAGE -->',
  '<!-- BEGIN:WHATS-INCLUDED-COUNT -->',
  INCLUDED_FIXTURE([
    '| Skills | 97 public (101 bundled) | `/project-setup`, `/deep-research` |',
    `| Agents | 13 | strict-reviewer${strays['WHATS-INCLUDED-COUNT'] || ''} |`,
    '| Hooks | 7 | pre-edit-guard, auto-format |',
    '| Rules | 11 | auto-loop-project, context-management |',
    '| Scripts | 23 | precommit runner, verify runner |',
  ]),
  '<!-- END:WHATS-INCLUDED-COUNT -->',
  '<!-- BEGIN:FULL-CATALOG -->',
  `<details><summary>All 97 public skills${strays['FULL-CATALOG'] || ''}</summary></details>`,
  '<!-- END:FULL-CATALOG -->',
].join('\n');

// The control class round 20 and round 21 both shipped without. Every control above calls
// `assertBlockIntegers` on a region handed to it, which proves the verdict works on whatever it is
// given and says nothing about whether production still hands it every region. Deleting a key from
// `assertDocumentCounts`' map, or its FULL-CATALOG call, left all tests green. This one goes red.
test('every count region is checked, not merely checkable', () => {
  assert.doesNotThrow(
    () => assertDocumentCounts(DOC_FIXTURE(), 'fixture', DOC_COUNTS),
    'negative control: a document publishing exactly its derived counts must pass'
  );
  for (const region of ['HERO-COUNT', 'INSTALL-COVERAGE', 'WHATS-INCLUDED-COUNT', 'FULL-CATALOG']) {
    assert.throws(
      () => assertDocumentCounts(DOC_FIXTURE({ [region]: '; 777 more' }), 'fixture', DOC_COUNTS),
      /was not built to publish/,
      `${region} must be reached by the document verdict — dropping it from the map must turn this red`
    );
  }
});

test('a version number beside the noun is still not a second count', () => {
  // The inverse failure, and the one that actually cost rounds: three adjacency rules in a row made
  // a CORRECT document fail here. `3（bundled skills` is not adjacent — nothing is stripped to make
  // it so — and the block's own integers are what decide whether a stray number exists.
  const withVersion = '| Plugin install | Claude Code | Full (99 bundled skills)；Claude 3（bundled skills 支援） |';
  assert.equal(
    installCoverageClaim(COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, withVersion)), 'fixture', 0, 'bundled skills'),
    99,
    'a version number enclosed beside the noun must not read as a second claim'
  );
  const block = (row) => ['<!-- BEGIN:INSTALL-COVERAGE -->', COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, row)), '<!-- END:INSTALL-COVERAGE -->'].join('\n');
  assert.doesNotThrow(
    () => assertBlockIntegers(block(COVERAGE_ROWS[0]), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
    'negative control: the real coverage shape'
  );
  assert.throws(
    () => assertBlockIntegers(block(withVersion), 'fixture', 'INSTALL-COVERAGE', [99, 99]),
    /was not built to publish/,
    'the version number IS an integer the block was not built to publish — the honest answer: a generated count block gained a number, which is reviewable rather than silently correct'
  );
});

test('a wrong row is still the row under test, and a decoy cannot take its place', () => {
  const wrong = '| Plugin install | Claude Code | Full (777 bundled skills, hooks) |';
  assert.equal(installCoverageClaim(COVERAGE_FIXTURE(COVERAGE_ROWS), 'fixture', 0, 'bundled skills'), 99,
    'positive control: the coverage row is read at its position');
  assert.equal(installCoverageClaim(COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, wrong)), 'fixture', 0, 'bundled skills'), 777,
    'the wrong number is returned rather than skipped — the caller is what compares it');
  assert.throws(
    () => installCoverageClaim(COVERAGE_FIXTURE([...withRow(COVERAGE_ROWS, 0, wrong), COVERAGE_ROWS[0]]), 'fixture', 0, 'bundled skills'),
    /found 6/,
    'appending a correct-looking Notes row is a schema change, not a second opinion'
  );
  assert.equal(
    installCoverageClaim(COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, '| Plugin install | Claude Code | Full (777 bundled **skills**) |')), 'fixture', 0, 'bundled skills'),
    777,
    'emphasis is formatting: the reader sees "777 bundled skills", so the guard must read it too'
  );
});

test("the What's-Included guard checks the row at its position, examples included", () => {
  const decoy = '| Notes | 99 public (99 bundled) | `/project-setup`, `/deep-research` |';
  assert.equal(whatsIncludedRow(INCLUDED_FIXTURE(INCLUDED_ROWS), 'fixture', 0, 'Skills', '/project-setup')[1],
    '99 public (99 bundled)', 'positive control: row 0 is the Skills row');
  assert.throws(
    () => whatsIncludedRow(INCLUDED_FIXTURE([decoy, ...INCLUDED_ROWS]), 'fixture', 0, 'Skills', '/project-setup'),
    /found 8/,
    'a signature-bearing decoy changes the table shape and is rejected there'
  );
  // The label is correct, so identity passes and the EXAMPLES assertion is the one that fires —
  // the mark is present, just in the count cell. A fixture that trips an earlier assertion leaves
  // this one with no negative control at all, which is how the previous version went vacuous.
  assert.throws(
    () => whatsIncludedRow(
      INCLUDED_FIXTURE(withRow(INCLUDED_ROWS, 0, '| Skills | 99 public (99 bundled) `/project-setup` | see below |')),
      'fixture', 0, 'Skills', '/project-setup'
    ),
    /examples moved out of the examples column/,
    'a signature in the count cell does not stand in for the examples cell'
  );
  assert.throws(
    () => whatsIncludedRow(
      INCLUDED_FIXTURE(withRow(withRow(INCLUDED_ROWS, 0, INCLUDED_ROWS[1].replace('| Agents |', '| Skills |')), 1, INCLUDED_ROWS[0].replace('| Skills |', '| Agents |'))),
      'fixture', 0, 'Skills', '/project-setup'
    ),
    /examples moved out of the examples column/,
    'a payload swap under correct labels is caught by the examples cell, not by the sequence'
  );
  assert.throws(
    () => whatsIncludedRow(
      INCLUDED_FIXTURE(withRow(INCLUDED_ROWS, 0, INCLUDED_ROWS[0].replace('| Skills |', '| Agents |'))),
      'fixture', 0, 'Skills', '/project-setup'
    ),
    /category column is not the expected sequence/,
    'swapping only the label cells leaves every payload correct and the document wrong'
  );
});

test('one selected row still has to carry exactly one count claim', () => {
  // Row position says nothing about what is inside the cell it selected: a stale claim left beside
  // the current one reads as correct to anything that stops at the first match.
  assert.throws(
    () => installCoverageClaim(
      COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, '| Plugin install | Claude Code | 99 bundled skills, previously 777 bundled skills |')),
      'fixture', 0, 'bundled skills'
    ),
    /expected exactly one/,
    'a stale claim beside the current one must not be masked by reading the first'
  );
  const twoClaims = whatsIncludedRow(
    INCLUDED_FIXTURE(withRow(INCLUDED_ROWS, 0, '| Skills | 99 public (99 bundled); 777 public (777 bundled) | `/project-setup` |')),
    'fixture', 0, 'Skills', '/project-setup'
  )[1];
  assert.throws(() => soleMatch(twoClaims, /(\d+) public \((\d+) bundled\)/g, 'fixture', 'Skills count claim'),
    /expected exactly one/, 'two count claims in the Skills cell is ambiguity, not a pass');
});

test('a table whose delimiter row was replaced is not a table', () => {
  assert.throws(
    () => installCoverageClaim(['| Method | Tools | Coverage |', ...COVERAGE_ROWS].join('\n'), 'fixture', 0, 'bundled skills'),
    /found 4|has no delimiter row|expected 3/,
    'without a delimiter row nothing below renders as a table, so nothing below is a published claim'
  );
  assert.throws(
    () => commandTableSections(['### Development (1)', '| Command | Purpose |', '| `/invented-skill` | not a separator |', '| `/bug-fix` | Fixing bugs |'].join('\n'), 'fixture', 'catalog'),
    /is not a delimiter row/,
    'a command row standing where the delimiter belongs must not be skipped as "row two"'
  );
});

test('tableCells splits on backslash PARITY, not on the preceding character', () => {
  // `\|` is a literal pipe in one cell; `\\|` is a rendered backslash and a REAL delimiter. A
  // lookbehind gets every even-length run backwards, and the damage runs both ways: a merged cell
  // turns an excess cell into the expected one (a wrong row reads as right), while a legitimate
  // trailing backslash makes the row unparseable (a right row is not found at all).
  // The cells come back as SOURCE, so what a reader sees is `renderInline` of them — the two are
  // asserted together because each was right alone while the composition dropped a backslash.
  const rendered = (line) => (tableCells(line) || []).map(renderInline);
  assert.deepEqual(tableCells('| a | b |'), ['a', 'b'], 'positive control: an ordinary row');
  assert.deepEqual(rendered('| a \\| b | c |'), ['a | b', 'c'], 'one backslash escapes the pipe');
  assert.deepEqual(rendered('| a \\\\| b |'), ['a \\', 'b'], 'two backslashes render one and leave a delimiter');
  assert.deepEqual(rendered('| a \\\\\\| b | c |'), ['a \\| b', 'c'], 'three: a rendered backslash then an escaped pipe');
  assert.equal(tableCells('| a | b \\|'), null, 'a row whose final pipe is escaped has no terminator');
  assert.deepEqual(rendered('| a | b \\\\|'), ['a', 'b \\'], 'but a cell may legitimately END in a rendered backslash');
});

// The composition, on the shape that broke it: three backslashes before a backtick are a rendered
// backslash plus an ESCAPED backtick, so no code span opens and the emphasis after it is live.
// Unescaping inside `tableCells` consumed the parity, and the guards then read a shielded claim.
test('an escaped backtick survives the split with its parity intact', () => {
  const cell = (body) => renderInline(tableCells(`| x | ${body} |`)[1]);
  assert.equal(cell('完整（99 bundled skills）'), '完整（99 bundled skills）', 'positive control: no escapes');
  assert.equal(cell('另誤載 \\\\\\`777 bundled _skills_\\\\\\`'), '另誤載 \\`777 bundled skills\\`',
    'the backticks are escaped, so the emphasis between them renders and the claim is visible');
  assert.equal(cell('`777 bundled _skills_`'), '`777 bundled _skills_`',
    'positive control: an UNescaped pair is still a code span whose contents stay literal');
});

test('the escaped-pipe parity fix reaches the count guards themselves', () => {
  assert.equal(
    installCoverageClaim(COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, '| Plugin install | Claude Code | 99 bundled skills \\| hooks |')), 'fixture', 0, 'bundled skills'),
    99,
    'an ordinary escaped pipe inside a cell must not break row identification'
  );
  assert.throws(
    () => installCoverageClaim(
      COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, '| Plugin install | Claude Code | 777 bundled skills \\| 99 bundled skills |')),
      'fixture', 0, 'bundled skills'
    ),
    /expected exactly one "bundled skills" count/,
    'an escaped pipe must not split a cell into a wrong half and a right half'
  );
  assert.throws(
    () => installCoverageClaim(
      COVERAGE_FIXTURE(withRow(COVERAGE_ROWS, 0, '| Plugin install | Claude Code \\\\| Full (777 bundled skills) | 99 bundled skills |')),
      'fixture', 0, 'bundled skills'
    ),
    /row 2 publishes 4 cells/,
    'an EVEN backslash run is a real delimiter, so the excess cell must not stand in for the coverage cell'
  );
});

test('the hero and summary guards reject a second, contradicting claim', () => {
  // A stale line left above a corrected one renders, contradicts it, and is invisible to any
  // reader that stops at the first match — the same masking the row guards were hardened against,
  // in prose rather than in a table.
  const hero = (body) => visibleMarkerBlockIn(
    `<!-- BEGIN:HERO-COUNT -->\n${body}\n<!-- END:HERO-COUNT -->`, 'HERO-COUNT', 'fixture');
  const one = '99 bundled · 99 public skills · 15 agents — ~4%';
  assert.equal(heroCountsIn(hero(one), 'fixture').publicSkills, 99,
    'positive control: a single hero claim is read');
  assert.throws(
    () => heroCountsIn(hero(`${one}\n777 bundled · 777 public skills · 777 agents — ~4%`), 'fixture'),
    /expected exactly one/,
    'a correct hero line followed by a contradicting one is ambiguity, not a pass'
  );
  assert.equal(catalogSummaryCountIn('<summary>All 99 public skills</summary>', 'fixture'), 99,
    'positive control: a single <summary> count is read');
  assert.throws(
    () => catalogSummaryCountIn('<summary>All 99 public skills</summary>\n<summary>All 777 public skills</summary>', 'fixture'),
    /expected exactly one/,
    'two <summary> counts must not resolve to the first'
  );
});

// The same masking one layer down: the second claim is present but its noun is split by emphasis,
// so a regex over the RAW source counts one claim where a reader sees two. Both readers matched the
// source until round 16, and both false documents passed the whole suite.
test('the hero and summary guards count claims as rendered, not as written', () => {
  const hero = (body) => visibleMarkerBlockIn(
    `<!-- BEGIN:HERO-COUNT -->\n${body}\n<!-- END:HERO-COUNT -->`, 'HERO-COUNT', 'fixture');
  const one = '99 bundled · 99 public skills · 15 agents — ~4%';
  assert.throws(
    () => heroCountsIn(hero(`${one}\n777 bundled · 777 public **skills** · 777 agents`), 'fixture'),
    /expected exactly one/,
    'emphasis inside the noun does not make a published hero claim stop counting'
  );
  assert.throws(
    () => catalogSummaryCountIn('<summary>All 99 public skills；實際 777 個 public **skills**</summary>', 'fixture'),
    /expected exactly one/,
    'nor inside the summary noun'
  );
  assert.equal(catalogSummaryCountIn('<summary>All **99** public skills</summary>', 'fixture'), 99,
    'positive control: emphasis on the NUMBER leaves exactly one claim, and it still reads');
});

test('the tool-gating guard reads its own row and its own column', () => {
  const table = (rows) => ['| # | Property | Mechanism | Evidence |', '|---|---|---|---|', ...rows].join('\n');
  const row = (ratio, extra = '') =>
    `| 5 | Tool gating | Skill frontmatter \`allowed-tools\` | ${ratio} public skills declare \`allowed-tools\` |${extra}`;
  // The decoy publishes the CORRECT ratio in the cell a claim-cell predicate would match on,
  // which is how a wrong row 5 passed review round 7.
  const decoy = '| 11 | Unrelated | Example | 90 of 99 public skills declare `allowed-tools` |';

  assert.deepEqual(toolGatingClaimIn(table([row('90 of 99')]), 'fixture'), { declaring: 90, total: 99 },
    'positive control: the claim is read from the evidence column, in publication order');
  assert.deepEqual(toolGatingClaimIn(table([row('99 of 90')]), 'fixture'), { declaring: 99, total: 90 },
    'a reversed ratio stays reversed — sorting the pair is what used to hide it');
  assert.throws(() => toolGatingClaimIn(table([row('90 of 99'), row('777 of 777')]), 'fixture'),
    /expected exactly one/, 'a duplicated row must not be resolved by taking the first');
  assert.throws(
    () => toolGatingClaimIn(table([row('777 of 777', ' 90 of 99 public skills declare `allowed-tools` |')]), 'fixture'),
    /should publish 4 cells, got 5/,
    'an excess fifth cell is not the fourth-column claim — arity is what rejects it'
  );
  assert.deepEqual(toolGatingClaimIn(table([row('777 of 777'), decoy]), 'fixture'), { declaring: 777, total: 777 },
    'a decoy carrying the right ratio must not stand in for row 5, whose claim is wrong');
  // This cell was the last numeric guard still on raw `\d+` with no sign clause: `-90 of 99`
  // parsed as [90, 99] and published a negative ratio green.
  for (const ratio of ['-90 of 99', '－90 of 99', '-**90** of 99']) {
    assert.throws(() => toolGatingClaimIn(table([row(ratio)]), 'fixture'), /signed number/,
      `a signed ratio contradicts itself and must be refused: ${ratio}`);
  }
  assert.deepEqual(toolGatingClaimIn(table([row('**90** of 99')]), 'fixture'), { declaring: 90, total: 99 },
    'negative control: emphasis alone is not a sign');
});

test('every README carries exactly one pair of each marker', () => {
  // The generator replaces marker blocks globally, so a duplicated pair whose contents are already
  // correct survives `--check` unchanged. Uniqueness therefore has to be asserted over the shipped
  // files, not inferred from the generator being idempotent.
  const strays = [];
  for (const file of ALL_READMES) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    for (const key of MARKER_KEYS) {
      const begins = lines.filter((l) => l.trim() === `<!-- BEGIN:${key} -->`).length;
      const ends = lines.filter((l) => l.trim() === `<!-- END:${key} -->`).length;
      if (begins !== 1 || ends !== 1) strays.push(`${file}:${key} → ${begins} BEGIN / ${ends} END`);
    }
  }
  assert.deepEqual(strays, [], `each marker must appear exactly once per README: ${strays.join(', ')}`);
});

test('a duplicated marker pair is ambiguity, not a pass', () => {
  const block = (n) => `<!-- BEGIN:HERO-COUNT -->\n${n} bundled · ${n} public skills · ${n} agents\n<!-- END:HERO-COUNT -->`;
  assert.equal(
    heroCountsIn(visibleMarkerBlockIn(block(99), 'HERO-COUNT', 'fixture'), 'fixture').bundled,
    99,
    'positive control: one pair resolves to its own content'
  );
  assert.throws(
    () => visibleMarkerBlockIn(`${block(99)}\n\n${block(777)}`, 'HERO-COUNT', 'fixture'),
    /exactly one <!-- BEGIN:HERO-COUNT -->/,
    'a second complete block renders and contradicts the first — reading the first is not a verdict'
  );
  assert.throws(
    () => visibleMarkerBlockIn('<!-- END:HERO-COUNT -->\n99 bundled\n<!-- BEGIN:HERO-COUNT -->', 'HERO-COUNT', 'fixture'),
    /precedes its BEGIN/,
    'an inverted pair is not a block'
  );
});

test('the tool-gating guard resolves row 5 by its number, not by which row mentions the mechanism', () => {
  const table = (rows) => ['| # | Property | Mechanism | Evidence |', '|---|---|---|---|', ...rows].join('\n');
  const real = '| 5 | Tool gating | Skill frontmatter `allowed-tools` | 90 of 99 public skills declare it |';
  // Round 8's shape: the intended row drops the mechanism signature and publishes a wrong ratio,
  // while a second row numbered 5 supplies both the signature and the correct numbers.
  const shadow = '| 5 | Unrelated | Example `allowed-tools` | 90 of 99 public skills declare `allowed-tools` |';
  const stripped = '| 5 | Tool gating | Skill frontmatter capability flags | 777 of 777 public skills declare it |';

  assert.deepEqual(toolGatingClaimIn(table([real]), 'fixture'), { declaring: 90, total: 99 }, 'positive control');
  assert.throws(() => toolGatingClaimIn(table([stripped, shadow]), 'fixture'), /expected exactly one/,
    'two rows numbered 5 is ambiguity, whichever of them names the mechanism');
  assert.throws(() => toolGatingClaimIn(table([stripped]), 'fixture'), /no longer names/,
    'row 5 losing its mechanism signature is reported, not silently matched elsewhere');
});

test('the registration guard rejects a command that is only quoted, not run', () => {
  const cmd = 'claude mcp add codex -- codex mcp-server';
  assert.match(renderMarkdown('```bash\n' + cmd + '\n```', { keepFenced: true }).join('\n'), CODEX_REGISTRATION,
    'positive control: the command itself registers Codex');
  assert.match(renderMarkdown('```bash\n$ ' + cmd + '\n```', { keepFenced: true }).join('\n'), CODEX_REGISTRATION,
    'a shell prompt in front of it is still the command');
  assert.doesNotMatch(renderMarkdown('```bash\necho ' + cmd + '\n```', { keepFenced: true }).join('\n'), CODEX_REGISTRATION,
    'echoing the command prints it and registers nothing — same words, wrong direction');
});

test('marker blocks may not interleave across keys', () => {
  // One BEGIN and one END for each key, each pair well-ordered, and still nonsense: A's block
  // swallows B's opener, and the contradictory line between END A and END B renders unchecked.
  const interleaved = [
    '<!-- BEGIN:HERO-COUNT -->', '99 bundled · 99 public skills · 15 agents',
    '<!-- BEGIN:INSTALL-COVERAGE -->', '<!-- END:HERO-COUNT -->',
    '777 bundled · 777 public skills · 777 agents', '<!-- END:INSTALL-COVERAGE -->',
  ].join('\n');
  assert.equal(
    heroCountsIn(visibleMarkerBlockIn('<!-- BEGIN:HERO-COUNT -->\n99 bundled · 99 public skills · 15 agents\n<!-- END:HERO-COUNT -->', 'HERO-COUNT', 'fixture'), 'fixture').agents,
    15,
    'positive control: a non-interleaved pair still reads'
  );
  assert.throws(() => visibleMarkerBlockIn(interleaved, 'HERO-COUNT', 'fixture'), /foreign marker opens inside/,
    'a block that contains another key\'s opener is not a block');
});

test('the catalog parser refuses a row it cannot read', () => {
  const table = (rows) => ['### Development (2)', '| Command | Purpose |', '|---|---|', ...rows].join('\n');
  const real = ['| `/bug-fix` | Fixing bugs |', '| `/feature-dev` | New features |'];
  assert.deepEqual(commandTableSections(table(real), 'fixture', 'catalog')[0].commands, ['bug-fix', 'feature-dev'],
    'positive control: ordinary command rows are collected');
  assert.throws(
    () => commandTableSections(table([...real, '| /invented-skill | Not in the catalog |']), 'fixture', 'catalog'),
    /is not a command/,
    'a rendered row the parser cannot read is a published claim nobody compares'
  );
});

for (const file of ALL_READMES) {
  test(`${file}: the Essential Skills table lists the catalog's featured entries in order`, () => {
    assert.deepEqual(
      essentialCommandsIn(file),
      featuredCatalogCommands(),
      `${file}: the Essential Skills block drifted from the catalog's featured entries`
    );
  });
}

test('the table schema refuses a header that publishes a claim, and spares one that counts examples', () => {
  const withHeader = (h) => [h, '|---|---|---|', ...COVERAGE_ROWS].join('\n');
  assert.equal(installCoverageClaim(withHeader('| 方式 | 適用工具 | 前 5 個範例 |'), 'fixture', 0, 'bundled skills'), 99,
    'a digit in a column NAME is not a claim — this is the over-broad rule the guard used to have');
  assert.throws(
    () => installCoverageClaim(withHeader('| Plugin install | Claude Code | 完整（777 bundled skills） |'), 'fixture', 0, 'bundled skills'),
    /publishes a count claim rather than naming a column/,
    'a claim row standing where the header belongs renders as the header and contradicts the table'
  );
});

test('the install methods are the three this document publishes, all three checked', () => {
  const swap = (i, cell, value) => COVERAGE_ROWS.map((r, k) => {
    if (k !== i) return r;
    const c = r.split('|');
    c[cell + 1] = ` ${value} `;
    return c.join('|');
  });
  assert.equal(installCoverageClaim(COVERAGE_FIXTURE(COVERAGE_ROWS), 'fixture', 0, 'bundled skills'), 99,
    'positive control: the three real methods pass');
  assert.throws(() => installCoverageClaim(COVERAGE_FIXTURE(swap(0, 1, 'Homebrew')), 'fixture', 0, 'bundled skills'),
    /not the three this document is supposed to publish/,
    'a different tool in row 0 is a different method, however right its coverage cell reads');
  assert.throws(() => installCoverageClaim(COVERAGE_FIXTURE(swap(1, 0, 'Homebrew（相容 `npx skills add`）')), 'fixture', 0, 'bundled skills'),
    /not the three this document is supposed to publish/,
    'mentioning the expected command is not being it — identity is exact, not a substring');
  // Row 2 is never selected by any caller; before this it was validated by nothing at all.
  assert.throws(() => installCoverageClaim(COVERAGE_FIXTURE(swap(2, 0, '手動設定')), 'fixture', 0, 'bundled skills'),
    /not the three this document is supposed to publish/,
    'a row no guard reads is still a row the document publishes');
});

test("the What's-Included category column is checked whole, including the rows no guard reads", () => {
  const swapped = INCLUDED_ROWS.map((r, k) => {
    if (k === 2) return r.replace('| Hooks |', '| Scripts |');
    if (k === 4) return r.replace('| Scripts |', '| Hooks |');
    return r;
  });
  assert.equal(whatsIncludedRow(INCLUDED_FIXTURE(INCLUDED_ROWS), 'fixture', 0, 'Skills', '/project-setup')[1],
    '99 public (99 bundled)', 'positive control: the real sequence passes');
  assert.throws(() => whatsIncludedRow(INCLUDED_FIXTURE(swapped), 'fixture', 0, 'Skills', '/project-setup'),
    /category column is not the expected sequence/,
    'Hooks and Scripts are read by no count guard, so only the label sequence can catch their swap');
});

test('the registration guard rejects a longer server name and a prompt with no space', () => {
  const fenced = (cmd) => renderMarkdown('```bash\n' + cmd + '\n```', { keepFenced: true }).join('\n');
  assert.match(fenced('claude mcp add codex -- codex mcp-server -c \'model_reasoning_effort="high"\''), CODEX_REGISTRATION,
    'positive control: the shipped command, options and all');
  assert.doesNotMatch(fenced('claude mcp add codex -- codex mcp-server-fake'), CODEX_REGISTRATION,
    'mcp-server-fake is a different server, and a word boundary does not say so');
  assert.doesNotMatch(fenced('$claude mcp add codex -- codex mcp-server'), CODEX_REGISTRATION,
    '`$claude` is not a prompt followed by the command; it is a different command');
});

test('a delimiter row whose cells are each valid may still be the wrong delimiter', () => {
  const section = (delimiter) => ['### Development (1)', '| Command | Purpose |', delimiter, '| `/bug-fix` | Fixing bugs |'].join('\n');
  assert.deepEqual(commandTableSections(section('|-------|----------|'), 'fixture', 'catalog')[0].commands, ['bug-fix'],
    'positive control: a delimiter matching the header arity');
  assert.throws(() => commandTableSections(section('|-------|'), 'fixture', 'catalog'),
    /publishes 1 cells against a 2-cell header/,
    'GFM requires the delimiter to match the header arity — per-cell syntax alone does not'
  );
});

// Durable controls for the refusal branches added in review rounds 13–14. Each one was verified by
// mutation at the time, but a mutation is evidence in a transcript, not a control in the suite:
// deleting the production branch has to turn something red here (rules/testing.md § Guards).

// Split by the question each one answers, at ≤ 7 assertions apiece (rules/testing.md § Conventions).
// None of these shapes appears in any locale, so a fixture is the only place these branches can be
// held: every one of them was measured green over the whole suite before its control existed.
test('renderInline strips emphasis in prose and leaves code spans literal', () => {
  assert.equal(renderInline('完整（777 bundled **skills**）'), '完整（777 bundled skills）',
    'strong emphasis is formatting — the reader sees one contiguous noun');
  assert.equal(renderInline('完整（777 bundled _skills_）'), '完整（777 bundled skills）',
    "CommonMark's other spelling of the same emphasis");
  assert.equal(renderInline('`**npx skills add**`'), '`**npx skills add**`',
    'inside a code span the asterisks are literal command text, not emphasis');
  assert.equal(renderInline('完整（777 bundled ***skills***）'), '完整（777 bundled skills）',
    'CommonMark renders *** as bold-italic — one pass leaves the inner pair and hides the noun');
  assert.equal(renderInline('完整（777 bundled ___skills___）'), '完整（777 bundled skills）',
    'the underscore spelling of the same nesting');
  // Balanced nesting collapses in one pass because the patterns run in sequence; an UNBALANCED run
  // does not, and that is the shape a false document would reach for. Measured by enumerating
  // {*, _, a} strings up to length 9: `***a*` is the shortest input where one pass stops early.
  assert.equal(renderInline('777 bundled ***skills*'), '777 bundled skills',
    'a single pass leaves *skills*, and the claim guards would read past the emphasised noun');
});

test('renderInline reads an intraword underscore as a character, not a delimiter', () => {
  assert.equal(renderInline('STOP_GUARD_MODE=strict'), 'STOP_GUARD_MODE=strict',
    'an intraword underscore is not emphasis — CommonMark prints it, so the guard must read it');
  assert.equal(renderInline('| 1_5 |'), '| 1_5 |',
    'the count the reader sees is 1_5, not 15 — stripping here would read a number nobody published');
  assert.equal(renderInline('| 1__5__9 |'), '| 1__5__9 |',
    'a run adjacent to another underscore is not a delimiter either');
  assert.equal(renderInline('__skills__'), 'skills',
    'positive control: the same delimiter IS emphasis when nothing flanks it');
  // Each SIDE of the flanking condition, alone. A symmetric fixture survives dropping either one
  // on its own, so both branches sat unprotected behind a control that looked like it covered them.
  assert.equal(renderInline('| 1__5_ |'), '| 1__5_ |', 'the left condition alone: an underscore precedes this run');
  assert.equal(renderInline('| _5__9 |'), '| _5__9 |', 'the right condition alone: an underscore follows it');
});

// The doubled pattern needs its own asymmetric pair: the shapes above are all one-underscore cases.
// These two are the shortest strings (enumerated over {_, 5, a, space}) that the correct rule leaves
// alone and a ONE-SIDED regression rewrites — `5______` and `______5` respectively.
test('renderInline reads each side of the doubled-underscore flanking rule', () => {
  assert.equal(renderInline('| 5______ |'), '| 5______ |', 'the left condition of the __ rule, alone');
  assert.equal(renderInline('| ______5 |'), '| ______5 |', 'the right condition of the __ rule, alone');
  assert.equal(renderInline('__777 bundled skills__'), '777 bundled skills',
    'positive control: the doubled delimiter still strips when nothing flanks it');
});

test('renderInline opens a code span only on a run that closes at its own width', () => {
  assert.equal(renderInline('實際 `777 bundled _skills_``'), '實際 `777 bundled skills``',
    'unequal backtick runs are not a code span — the emphasis inside them is live and must be stripped');
  assert.equal(renderInline('odd ` backtick with _skills_'), 'odd ` backtick with skills',
    'a run that never closes is literal punctuation, and what follows it is ordinary prose');
  // The scanner shielded whatever sat between two ESCAPED backticks, which a reader sees as two
  // punctuation marks around live emphasis — the contradictory claim was invisible to the guards.
  assert.equal(renderInline('另誤載 \\`777 bundled _skills_\\`'), '另誤載 `777 bundled skills`',
    'an escaped backtick renders as one backtick and delimits nothing, so the emphasis inside is live');
  assert.equal(renderInline('另誤載 \\*777\\* bundled skills'), '另誤載 *777* bundled skills',
    'an escaped asterisk renders as an asterisk — emitting the backslash put one inside the claim');
  assert.equal(renderInline('777 bundled\\ skills'), '777 bundled\\ skills',
    'CommonMark escapes ASCII punctuation only, so this backslash is one the reader sees');
  assert.equal(renderInline('`777 bundled _skills_`'), '`777 bundled _skills_`',
    'positive control: an UNescaped pair is a real code span and its contents stay literal');
});

test('a code-span identity is one whole span, not a cell with backticks in it', () => {
  assert.equal(codeSpanText('`npx skills add`'), 'npx skills add', 'positive control');
  assert.equal(codeSpanText('``npx skills add``'), 'npx skills add',
    'a doubled delimiter is a formatting choice, not a different command');
  assert.equal(codeSpanText('`npx` skills `add`'), null,
    'three spans are three fragments, not one copyable command');
  assert.equal(codeSpanText('npx skills ad`d'), null, 'an unmatched backtick is not a code span');
  assert.equal(codeSpanText('npx skills add'), null, 'plain text is not the published command');
  // The anchored /^(`+)(.+)\1$/ this replaced backtracked into its own opening run and read these
  // as the commands `x and x` — a delimiter contract the helper claimed but did not enforce.
  assert.equal(codeSpanText('```x``'), null, 'a run that opens wider than it closes is not a span');
  assert.equal(codeSpanText('``x```'), null, 'nor one that closes wider than it opens');
});

test('the install rows are refused when their identity cells are wrong', () => {
  const swap = (i, cell, value) => COVERAGE_ROWS.map((r, k) => {
    if (k !== i) return r;
    const c = r.split('|');
    c[cell + 1] = ` ${value} `;
    return c.join('|');
  });
  const claim = (rows) => installCoverageClaim(COVERAGE_FIXTURE(rows), 'fixture', 0, 'bundled skills');
  assert.equal(claim(COVERAGE_ROWS), 99, 'positive control');
  assert.throws(() => claim(swap(0, 0, 'Homebrew')), /is not the plugin-install method/,
    'the translated method LABEL is identity too — a correct tools cell does not make it Plugin install');
  assert.throws(() => claim(swap(1, 0, '`npx` skills `add`')), /not the three this document/,
    'a command split across three code spans is not the command');
  assert.throws(() => claim(swap(1, 0, '`**npx skills add**`')), /not the three this document/,
    'emphasis characters inside a code span are published literally');
  assert.equal(claim(swap(1, 0, '``npx skills add``')), 99, 'a doubled delimiter still passes');
});

test('a table-only block is refused when it publishes anything but its table', () => {
  const claim = (extra) => installCoverageClaim([extra, COVERAGE_FIXTURE(COVERAGE_ROWS)].join('\n'), 'fixture', 0, 'bundled skills');
  assert.equal(claim(''), 99, 'positive control: a blank line is not a claim');
  assert.throws(() => claim('777 bundled skills'), /not part of its table/,
    'prose beside a valid table renders, contradicts it, and is read by no table guard');
});

test('a header that publishes a bare number is not a header', () => {
  const withHeader = (h) => whatsIncludedRow([h, '|---|---|---|', ...INCLUDED_ROWS].join('\n'), 'fixture', 0, 'Skills', '/project-setup');
  assert.equal(withHeader('| Category | Count | Examples |')[1], '99 public (99 bundled)', 'positive control');
  assert.throws(() => withHeader('| Agents | 777 | Examples |'), /publishes a count claim rather than naming a column/,
    'a bare number in the header is a claim the table guards never read');
});

// Both resources, and through `includedResourceCount` — the same function the six per-locale tests
// call. A control that rebuilds the read inline verifies its own copy: it stayed green while the
// real readers were reverted to a whole-file search (round 15), which is the regression it names.
for (const [resource, decoy, authoritative] of [
  ['hooks', '| Hooks | 6 | pre-edit-guard, auto-format |', '| Hooks | 777 | pre-edit-guard, auto-format |'],
  ['scripts', '| Scripts | 21 | precommit runner, verify runner |', '| Scripts | 777 | precommit runner, verify runner |'],
]) {
  test(`the ${resource} row is read inside its block, not found in the document`, () => {
    const label = authoritative.slice(0, authoritative.indexOf('|', 2) + 1);
    const doc = (before) => [
      before,
      '<!-- BEGIN:WHATS-INCLUDED-COUNT -->',
      INCLUDED_FIXTURE(INCLUDED_ROWS.map((r) => (r.startsWith(label) ? authoritative : r))),
      '<!-- END:WHATS-INCLUDED-COUNT -->',
    ].join('\n');
    assert.equal(includedResourceCount(doc(''), 'fixture', resource), 777,
      'the authoritative row is the one inside the block');
    assert.equal(includedResourceCount(doc(decoy), 'fixture', resource), 777,
      `a correct-looking ${resource} decoy above the block must not answer for it — a whole-file search returned the decoy here`);
  });
}

// Where the two guards divide, stated as the assertions themselves rather than as prose about them.
// Emphasis is formatting the reader never sees, so `renderInline` removes it and the count lands
// adjacent — that stays this extractor's job. A mark the reader DOES see (`「777」`, `(777)`) leaves
// the text non-adjacent, and no attempt to make it adjacent survived: each one also swallowed
// `Claude 3（bundled skills 支援）`. That half belongs to the block guard, which does not care what
// the digits sit next to.
test('a coverage count is read through formatting but not through visible punctuation', () => {
  const block = (coverage) => ['| Method | Tools | Coverage |', '|---|---|---|',
    ...withRow(COVERAGE_ROWS, 0, `| Plugin install | Claude Code | ${coverage} |`)].join('\n');
  assert.equal(installCoverageClaim(block('Full (99 bundled skills, hooks)'), 'fixture', 0, 'bundled skills'), 99,
    'positive control: the ordinary adjacent form still reads');
  assert.throws(
    () => installCoverageClaim(block('Full (99 bundled skills); also *777* bundled skills'), 'fixture', 0, 'bundled skills'),
    /expected exactly one/,
    'emphasis renders away, so the reader sees two claims and so must the guard'
  );
  assert.equal(
    installCoverageClaim(block('Full (99 bundled skills); also 「777」 bundled skills'), 'fixture', 0, 'bundled skills'),
    99,
    'visibly quoted, this extractor reads past it — the block guard below is what refuses the 777'
  );
  assert.throws(
    () => assertBlockIntegers(
      ['<!-- BEGIN:INSTALL-COVERAGE -->', block('Full (99 bundled skills); also 「777」 bundled skills'), '<!-- END:INSTALL-COVERAGE -->'].join('\n'),
      'fixture', 'INSTALL-COVERAGE', [99, 99]
    ),
    /was not built to publish/,
    'and it does refuse it: the stray 777 is caught without any rule about what 「」 means'
  );
});

// The other direction, and the one a gap rule got wrong: an unrelated number NEAR the noun is not a
// count of it. Admitting decorated counts by widening the gap admitted these too, and a correct
// document then failed CI — which is a broken guard, not a strict one.
test('a number that counts something else is not a coverage claim', () => {
  const block = (coverage) => ['| Method | Tools | Coverage |', '|---|---|---|',
    ...withRow(COVERAGE_ROWS, 0, `| Plugin install | Claude Code | ${coverage} |`)].join('\n');
  assert.equal(installCoverageClaim(block('Full (99 bundled skills); Claude 3 has bundled skills support'),
    'fixture', 0, 'bundled skills'), 99, 'a version number separated by a word is not a second count');
  assert.equal(installCoverageClaim(block('Full (99 bundled skills)；Claude 3 — bundled skills 支援'),
    'fixture', 0, 'bundled skills'), 99, 'nor one separated by a dash');
  assert.equal(installCoverageClaim(block('Full (99 bundled skills)；Claude 3 版的 bundled skills 支援'),
    'fixture', 0, 'bundled skills'), 99, 'nor one separated by a locale possessive');
});

test('the catalog summary count is the one attached to `public skills`', () => {
  const block = (summary) => `<summary>${summary}</summary>`;
  assert.equal(catalogSummaryCountIn(block('全部 99 個 public skills'), 'fixture'), 99,
    'positive control: the locale counter word sits between the number and the noun');
  assert.equal(catalogSummaryCountIn(block('99 個分類；777 個 public skills'), 'fixture'), 777,
    'the first number in the summary is not the claim — the one at the noun is');
});
