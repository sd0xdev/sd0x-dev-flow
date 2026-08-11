'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkFile, scanFile, inlineTargets, inlineMatches, main, maskRanges,
} = require('../../scripts/check-doc-links');

/**
 * A throwaway repository root. `realpathSync` because macOS resolves `/var` to `/private/var`, and
 * the containment check compares real paths — without it every fixture reads as outside the repo.
 */
function repo(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-links-')));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

const reasons = (failures) => failures.map((f) => f.reason).sort();
const targets = (failures) => failures.map((f) => f.target).sort();

test('a relative link to a missing file → dead-link', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'See [the design](./3-architecture.md).\n',
  });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['dead-link']);
  assert.equal(failures[0].target, './3-architecture.md');
  assert.equal(failures[0].line, 1);
});

test('a relative link to a file that exists → no failure', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'See [the design](./3-architecture.md).\n',
    'docs/features/auth/3-architecture.md': '# Architecture\n',
  });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(failures, [], 'a resolvable link is not a finding');
});

test('external URLs and templated placeholders are skipped, not resolved', () => {
  const root = repo({
    'skills/doc-review/SKILL.md': [
      '# Doc review',
      '',
      'Spec: [CommonMark](https://spec.commonmark.org/0.31.2/).',
      'Mail: [the owner](mailto:owner@example.com).',
      'Target: [the spec](docs/features/{FEATURE}/2-tech-spec.md).',
      'Root: [the runner](${CLAUDE_PLUGIN_ROOT}/scripts/run-skill.sh).',
      'Slot: [the feature doc](docs/features/<feature>/1-requirements.md).',
      '',
    ].join('\n'),
  });

  const failures = checkFile('skills/doc-review/SKILL.md', root);

  assert.deepEqual(failures, [], 'nothing here is this checkout\'s to resolve');
});

test('a traversal target outside the repository → outside-repository, not dead-link', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'See [passwd](../../../../etc/passwd).\n' });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['outside-repository']);
  assert.notEqual(failures[0].reason, 'dead-link',
    'the distinction is the point: one is a typo, the other is an escape');
});

test('a symlink whose target escapes the repository → outside-repository', () => {
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-links-out-')));
  fs.writeFileSync(path.join(outside, 'secrets.md'), '# Secrets\n');
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'See [notes](./escape.md).\n' });
  fs.symlinkSync(path.join(outside, 'secrets.md'), path.join(root, 'docs/features/auth/escape.md'));

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['outside-repository'],
    'the link resolves and the file exists — containment is decided on the real path');
});

test('a symlink that stays inside the repository resolves normally', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'See [notes](./linked.md).\n',
    'docs/features/auth/3-architecture.md': '# Architecture\n',
  });
  fs.symlinkSync(path.join(root, 'docs/features/auth/3-architecture.md'),
    path.join(root, 'docs/features/auth/linked.md'));

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(failures, [], 'containment rejects escapes, not symlinks');
});

test('a link inside a fenced example is not a link', () => {
  const root = repo({
    'skills/doc-review/SKILL.md': [
      '# Doc review',
      '',
      '```markdown',
      'See [the design](./never-existed.md).',
      '```',
      '',
      'And a real one: [the spec](./2-tech-spec.md).',
      '',
    ].join('\n'),
  });

  const failures = checkFile('skills/doc-review/SKILL.md', root);

  assert.deepEqual(targets(failures), ['./2-tech-spec.md'],
    'the fenced example is documentation of a link, not a link');
});

test('a reference definition is resolved like any other link', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': [
      '# Auth',
      '',
      'See [the design][design].',
      '',
      '[design]: ./3-architecture.md',
      '',
    ].join('\n'),
  });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['dead-link'],
    'the target lives in the definition, so that is where it must be resolved');
});

test('an unreadable document is reported rather than skipped', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '# Auth\n' });

  const failures = checkFile('docs/features/auth/9-absent.md', root);

  assert.deepEqual(reasons(failures), ['unreadable'],
    'a document the checker cannot open is a fact the reviewer needs, not silence');
});

test('the checker is advisory: a dead link still exits 0', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'See [gone](./gone.md).\n' });
  const written = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };

  let code;
  try {
    code = main(['--root', root, 'docs/features/auth/2-tech-spec.md']);
  } finally {
    process.stdout.write = realWrite;
  }

  assert.equal(code, 0, 'a non-zero exit would make this a gate');
  const report = JSON.parse(written.join(''));
  assert.equal(report.checked, 1);
  assert.deepEqual(reasons(report.failures), ['dead-link'], 'the finding is still reported');
});

// ── The advisory contract under hostile input ──────────────────────────────

test('a malformed percent-escape is a finding, not a thrown URIError', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'See [notes](bad%ZZ.md) and [ok](#auth).\n\n# Auth\n' });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['malformed-target'],
    'decodeURIComponent throws on %ZZ; an always-exit-0 checker cannot let one link abort the run');
  assert.equal(failures[0].target, 'bad%ZZ.md');
});

test('a malformed target still exits 0 and still prints the report', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'See [notes](bad%ZZ.md).\n' });
  const written = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };

  let code;
  try {
    code = main(['--root', root, 'docs/features/auth/2-tech-spec.md']);
  } finally {
    process.stdout.write = realWrite;
  }

  assert.equal(code, 0);
  assert.deepEqual(reasons(JSON.parse(written.join('')).failures), ['malformed-target']);
});

test('a destination with nested parentheses is one target, not zero', () => {
  assert.deepEqual(inlineTargets('See [x](a(b(c)).md) here.'), ['a(b(c)).md'],
    'a target the scanner never returns is silently reported as checked and passing');
  assert.deepEqual(inlineTargets('See [x](plain.md) and ![i](img(1).png).'), ['plain.md', 'img(1).png']);
  assert.deepEqual(inlineTargets('See [x](<a b.md>) and [y](t.md "title").'), ['a b.md', 't.md']);
});

test('a nested-parenthesis target that does not exist is reported like any other', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'See [x](./a(b).md).\n' });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['dead-link'],
    'scanning it is only useful if the finding then reaches the report');
  assert.equal(failures[0].target, './a(b).md');
});

// ── The scanner must recognize a link, not the byte pair `](` ──────────────

test('a `](` that no `[` opens is not a link', () => {
  assert.deepEqual(inlineTargets('plain ](ghost.md) text'), [],
    'without a label opener this is punctuation, and reporting it invents a finding');
  assert.deepEqual(inlineTargets('[x](real.md)'), ['real.md'], 'the positive control');
});

test('a link inside a code span is a description of a link', () => {
  assert.deepEqual(inlineTargets('Write `[x](ghost.md)` like this.'), []);
  assert.deepEqual(inlineTargets('Write ``a ` b`` then [x](real.md).'), ['real.md'],
    'a multi-backtick span closes on its own run length, and the live link after it still counts');
});

test('an escaped delimiter is not a delimiter, in either direction', () => {
  assert.deepEqual(inlineTargets('[x\\](ghost.md)'), [],
    'the `]` is escaped, so nothing closes the label');
  assert.deepEqual(inlineTargets('[x\\\\](real.md)'), ['real.md'],
    'two backslashes escape each other, so the `]` is live again');
  assert.deepEqual(inlineTargets('[x](a\\(b\\).md)'), ['a(b).md'],
    'the filesystem sees the unescaped name, so the target must be unescaped before resolution');
});

test('an unterminated title means the link is not closed', () => {
  // The `)` is present, so nothing but the title check can refuse this one — the earlier fixture
  // (`[x](a.md "unterminated`, no parenthesis at all) was refused by the closing-paren search and
  // would stay green with the title validation deleted.
  assert.deepEqual(inlineTargets('[x](a.md "unterminated)'), []);
  assert.deepEqual(inlineTargets('[x](a.md "terminated")'), ['a.md'], 'the positive control');
  assert.deepEqual(inlineTargets("[x](a.md 'single')"), ['a.md']);
});

test('an angle destination is closed by the same rules as a bare one', () => {
  assert.deepEqual(inlineTargets('[x](<a.md> "unterminated)'), [],
    'the angle branch used to accept whatever `)` came next, title or not');
  assert.deepEqual(inlineTargets('[x](<a.md> garbage)'), [],
    'and prose after the destination is not a title');
  assert.deepEqual(inlineTargets('[x](<a.md> "terminated")'), ['a.md'], 'the positive control');
});

test('the escape set is the whole escapable punctuation range, not a sample', () => {
  assert.deepEqual(inlineTargets('[x](a\\&b.md)'), ['a&b.md'],
    'a character left escaped is a backslash in the path, and the file is then reported missing');
  assert.deepEqual(inlineTargets('[x](a\\~b\\!c.md)'), ['a~b!c.md']);
});

test('an unbalanced destination is not a target', () => {
  assert.deepEqual(inlineTargets('[x](a(b.md)'), [],
    'the parenthesis never closes, so there is no destination to resolve');
});

test('two dots inside a filename are a typo, not an escape', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'See [notes](./missing..note.md).\n' });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['dead-link'],
    'path.resolve already normalized real parent segments; what is left is part of the name');
});

// ── The unit is the block, because neither construct stops at a newline ─────

test('a label split across lines is still one link', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'See [the\ndesign](./3-architecture.md) here.\n',
  });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['dead-link'],
    'scanned per line the label loses its opener, and the dead link is reported as checked');
  assert.equal(failures[0].line, 2, 'the destination sits on the second line of the block');
});

test('a code span that closes on the next line still masks what it opened', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'Write `like [x](ghost.md)\nthis` in prose.\n',
  });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(failures, [],
    'per line the opening backtick never closes, the first line goes unmasked, and the finding is invented');
});

test('a blank line ends the block, so an unclosed span cannot mask the whole document', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'An unmatched ` backtick.\n\nThen [x](./ghost.md).\n',
  });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['dead-link']);
  assert.equal(failures[0].line, 3);
});

test('a reference destination is parsed, not split on whitespace', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'Use [notes].\n\n[notes]: <./a b.md> "title"\n',
    'docs/features/auth/a b.md': '# Notes\n',
  });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(failures, [],
    '`\\S+` truncated this to `<./a` and reported a dead link to a file nobody wrote');
});

test('a paragraph that opens with brackets is not a reference definition', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '[note]: ./ghost.md and then some prose.\n',
  });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(failures, [],
    'a destination may be followed by a title and nothing else; resolving this one would be a guess');
});

// ── A block ends where a new leaf block begins, not only at a blank line ────

test('a stray backtick in one list item cannot mask the next item', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '- an unmatched ` backtick\n- see [x](./ghost.md) `\n',
  });

  const failures = checkFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(failures), ['dead-link'],
    'one run of non-blank lines is not one block: the span would swallow the next item entirely');
  assert.equal(failures[0].line, 2);
});

test('a heading ends the block above it', () => {
  // Both backticks are needed: with one, scanning the whole text still finds the link and the test
  // stays green with the boundary removed. Here the span would close *across* the heading.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'An opening ` backtick.\n## Next\nThen [x](./ghost.md) `.\n',
  });

  assert.deepEqual(reasons(checkFile('docs/features/auth/2-tech-spec.md', root)), ['dead-link']);
});

test('a table row is its own block', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '| ` | b |\n| --- | --- |\n| y | [x](./ghost.md) ` |\n',
  });

  assert.deepEqual(reasons(checkFile('docs/features/auth/2-tech-spec.md', root)), ['dead-link'],
    'a lone backtick in one row must not reach across rows');
});

test('a cell is its own inline context', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '| a | b |\n| --- | --- |\n| ` | [x](./ghost.md) ` |\n',
  });

  assert.deepEqual(reasons(checkFile('docs/features/auth/2-tech-spec.md', root)), ['dead-link'],
    'the two backticks sit in different cells, so neither opens a span over the other');
});

test('markdown inside a raw HTML block is markup, not a link', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '<div title="[x](./ghost.md)">\ntext\n</div>\n',
  });

  assert.deepEqual(checkFile('docs/features/auth/2-tech-spec.md', root), [],
    'CommonMark disables markdown there, so a finding raised on it is invented');
});

test('an HTML block a list marker carries is markup, not an established dead link', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '- <div>\n  [x](./ghost.md)\n  </div>\n',
    'docs/features/auth/3-architecture.md': '- [x](./ghost.md)\n',
  });

  const carried = scanFile('docs/features/auth/2-tech-spec.md', root);
  const plain = scanFile('docs/features/auth/3-architecture.md', root);

  assert.deepEqual(carried.failures, [],
    'the marker only hid the opener from the quote-aware path; the finding would be invented');
  assert.equal(carried.unresolved, 1, 'declining it is the exit — vanishing is not');
  assert.deepEqual(plain.failures.map((f) => f.reason), ['dead-link'],
    'without this control the guard above would also pass on a scanner that reads no list item');
});

test('a comment ends with the container that opened it, so what follows is not silently owned', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> <!--\n[x](./ghost.md)\n-->\n',
    'docs/features/auth/3-architecture.md': '<!-- \n[x](./ghost.md)\n -->\n',
  });

  const quoted = scanFile('docs/features/auth/2-tech-spec.md', root);
  const plain = scanFile('docs/features/auth/3-architecture.md', root);

  assert.deepEqual(quoted.failures, [], 'the comment is not read, so no finding is invented');
  assert.equal(quoted.unresolved, 1,
    'a comment reaching past its quote swallowed this candidate whole and reported nothing');
  assert.deepEqual(plain.failures, [], 'uncontained, the same comment does own the line');
  assert.equal(plain.unresolved, 0,
    'the control: a settled comment is coverage, and counting it would report a debt that is not owed');
});

test('a multi-line comment opened on a list-carried line is declined, not decided', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '- <!--\n- [x](./ghost.md)\n-->\n',
    'docs/features/auth/3-architecture.md': '- <!--\n  [x](./ghost.md)\n  -->\n',
    'docs/features/auth/4-implementation.md': '<!--\n[x](./ghost.md)\n-->\n',
  });

  const sibling = scanFile('docs/features/auth/2-tech-spec.md', root);
  const owned = scanFile('docs/features/auth/3-architecture.md', root);
  const plain = scanFile('docs/features/auth/4-implementation.md', root);

  assert.deepEqual(sibling.failures, [], 'the comment ends with the first item, but proving that needs a list model');
  assert.equal(sibling.unresolved, 1, 'so the sibling item link is declined — swallowing it reported nothing');
  assert.deepEqual(owned.failures, [], 'here the comment genuinely owns the link');
  assert.equal(owned.unresolved, 1, 'and the same decline covers it — neither direction is invented');
  assert.deepEqual(plain.failures, [], 'uncarried, the comment is settled coverage');
  assert.equal(plain.unresolved, 0, 'the control: declining every multi-line comment would be a regression');
});

test('a comment that does not close inside its table cell is literal text, not a comment', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '| a | b |\n| --- | --- |\n| <!-- | [x](./ghost.md) --> |\n',
    'docs/features/auth/3-architecture.md': '| a | b |\n| --- | --- |\n| <!-- [x](./ghost.md) --> | ok |\n',
  });

  const cross = scanFile('docs/features/auth/2-tech-spec.md', root);
  const inside = scanFile('docs/features/auth/3-architecture.md', root);

  assert.deepEqual(cross.failures.map((f) => f.reason), ['dead-link'],
    'GFM splits cells first, so the unescaped pipe ends the cell and the next cell link is live');
  assert.equal(cross.unresolved, 0);
  assert.deepEqual(inside.failures, [], 'closed within its cell, the comment owns its link');
  assert.equal(inside.unresolved, 0, 'the control: a settled in-cell comment is not new debt');
});

test('an inline comment is owned by its leaf block, and unclosed there it is literal text', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'text\ncontinued <!--\n# [x](./ghost.md)\n-->\n',
    'docs/features/auth/3-architecture.md': '- text\ncontinued <!--\n- [x](./ghost.md)\n-->\n',
    'docs/features/auth/4-implementation.md': 'a <!--\nb -->\nc [x](./ghost.md)\n',
  });

  const heading = scanFile('docs/features/auth/2-tech-spec.md', root);
  const sibling = scanFile('docs/features/auth/3-architecture.md', root);
  const closed = scanFile('docs/features/auth/4-implementation.md', root);

  assert.deepEqual(heading.failures.map((f) => f.reason), ['dead-link'],
    'the heading interrupts the paragraph the comment opened in, so its link is live');
  assert.equal(heading.unresolved, 0);
  assert.deepEqual(sibling.failures.map((f) => f.reason), ['dead-link'],
    'a lazy continuation line has no marker for listCarried to see — the block bound must catch it');
  assert.deepEqual(closed.failures.map((f) => f.reason), ['dead-link'],
    'the control: closing inside its block, the comment owns lines one and two but not line three');
  assert.equal(closed.unresolved, 0, 'a settled inline comment is coverage, not debt');
});

test('a bound is not a terminator: only a real `-->` inside the owner proves an inline comment', () => {
  const root = repo({
    // The terminator sits on a lazy line that may be this very paragraph — in which case the
    // comment closes over the link. Neither reading is provable, so the candidate is declined.
    'docs/features/auth/2-tech-spec.md': '> text <!--\n> [x](./ghost.md)\nplain -->\n',
    // No terminator at all, and EOF landing on the block end must not masquerade as one: the
    // opener is literal text and the link below it is live.
    'docs/features/auth/3-architecture.md': 'text <!--\n[x](./ghost.md)',
    // A blank line ends the paragraph decisively, so the unclosed opener is literal and the next
    // paragraph's link reports.
    'docs/features/auth/4-implementation.md': 'text <!--\n\n[x](./ghost.md) -->\n',
  });

  const lazyTerm = scanFile('docs/features/auth/2-tech-spec.md', root);
  const eof = scanFile('docs/features/auth/3-architecture.md', root);
  const blank = scanFile('docs/features/auth/4-implementation.md', root);

  assert.deepEqual(lazyTerm.failures, [], 'deciding the lazy line either way invents an answer');
  assert.equal(lazyTerm.unresolved, 1);
  assert.deepEqual(eof.failures.map((f) => f.reason), ['dead-link'],
    'an unterminated inline comment is literal text, whatever offset EOF happens to share');
  assert.equal(eof.unresolved, 0);
  assert.deepEqual(blank.failures.map((f) => f.reason), ['dead-link']);
  assert.equal(blank.unresolved, 0);
});

test('only the block edge decides ambiguity, and a literal opener frees its own line', () => {
  const root = repo({
    // A decisive heading stands at the paragraph's edge, so the paragraph ended there whatever
    // the lazy line further down might have been — the comment is literal, the heading link live.
    'docs/features/auth/2-tech-spec.md': 'a <!--\n# real [x](./ghost.md)\n> quoted\nlazy -->\n',
    // The candidate sits between a literal opener and the block end: literal means parsed, so both
    // links report — a blanket decline here would be cost the grammar already paid for.
    'docs/features/auth/3-architecture.md': 'a <!-- [x](./ghost.md)\n\n[y](./ghost.md) -->\n',
    // A table row opening with an unterminated comment: the cell rule makes it literal before the
    // block-form path could run it to EOF over the row below.
    'docs/features/auth/4-implementation.md': '<!-- | a |\n| --- | --- |\n| [x](./ghost.md) | b |\n',
  });

  const mixed = scanFile('docs/features/auth/2-tech-spec.md', root);
  const sameLine = scanFile('docs/features/auth/3-architecture.md', root);
  const tableStart = scanFile('docs/features/auth/4-implementation.md', root);

  assert.deepEqual(mixed.failures.map((f) => f.reason), ['dead-link']);
  assert.equal(mixed.unresolved, 0, 'the lazy line past the heading is not this paragraph');
  assert.deepEqual(sameLine.failures.map((f) => f.reason), ['dead-link', 'dead-link']);
  assert.equal(sameLine.unresolved, 0);
  assert.deepEqual(tableStart.failures.map((f) => f.reason), ['dead-link']);
  assert.equal(tableStart.unresolved, 0);
});

test('an undecided extent stops at its own block, and an undecided edge stays undecided', () => {
  const root = repo({
    // The lazy line is ambiguous, but the blank line after it ends every reading: the later
    // paragraph is ordinary Markdown and its dead link must be reported, not swept into the
    // declined range on the way to a far terminator.
    'docs/features/auth/2-tech-spec.md': '> a <!--\n> [x](./m.md)\nlazy\n\n[y](./ghost.md)\nmore -->\n',
    // `2.` cannot interrupt a paragraph, so no fence opened and the terminator line may close the
    // comment over the candidate — literal parsing here would invent the finding.
    'docs/features/auth/3-architecture.md': 'a <!-- [x](./ghost.md)\n2. ```\ntext -->\n',
  });

  const far = scanFile('docs/features/auth/2-tech-spec.md', root);
  const fence = scanFile('docs/features/auth/3-architecture.md', root);

  assert.deepEqual(far.failures.map((f) => f.target), ['./ghost.md'],
    'the declined range may cover its own block only — beyond it, blocks answer for themselves');
  assert.equal(far.unresolved, 1);
  assert.deepEqual(fence.failures, []);
  assert.equal(fence.unresolved, 1, 'an undecidable edge declines the candidate, in both variants');
});

test('an ordered marker other than 1 is no edge: it cannot interrupt the paragraph', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'a <!-- [x](./ghost.md)\n2. ordinary\nclose -->\n',
    'docs/features/auth/3-architecture.md': 'a <!-- [x](./ghost.md)\n1. item\nclose -->\n',
  });

  const two = scanFile('docs/features/auth/2-tech-spec.md', root);
  const one = scanFile('docs/features/auth/3-architecture.md', root);

  assert.deepEqual(two.failures, [],
    'the 2. line may be this paragraph, closing the comment over the link — literal would invent');
  assert.equal(two.unresolved, 1);
  assert.deepEqual(one.failures.map((f) => f.reason), ['dead-link'],
    'the control: 1. does interrupt, the paragraph ends, the opener is literal and the link live');
  assert.equal(one.unresolved, 0);
});

test('a quoted ordered marker at the edge is a quote first: it interrupts whatever its number', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'a <!-- [x](./ghost.md)\n> 2. quoted\nclose -->\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures.map((f) => f.reason), ['dead-link'],
    'the depth change is the interrupt — only a same-depth ordered marker leaves the edge open');
  assert.equal(scan.unresolved, 0);
});

test('an ordered marker keeps its 0-3 spaces of indentation inside the quote', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> a <!-- [x](./ghost.md)\n>   2. quoted\n> close -->\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [],
    'two content spaces do not unmake the marker — the edge stays ambiguous and nothing is proven');
  assert.equal(scan.unresolved, 1);
});

test('interruption is decided by the marker number, not its spelling: 01. is start number 1', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'a <!-- [x](./ghost.md)\n01. item\nclose -->\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures.map((f) => f.reason), ['dead-link'],
    '01. may interrupt — declining it over-declines, the paragraph ends and the link is parsed');
  assert.equal(scan.unresolved, 0);
});

test('02. is start number 2 whatever its spelling: the edge stays ambiguous', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'a <!-- [x](./ghost.md)\n02. item\nclose -->\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, []);
  assert.equal(scan.unresolved, 1);
});

test('CRLF line endings reach every line-anchored predicate normalized', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '| a | b |\r\n| --- | --- |\r\n| ` | [x](./ghost.md) ` |\r\n',
    'docs/features/auth/3-architecture.md': '> | a | b |\r\n> | --- | --- |\r\n> | ` | [x](./ghost.md) ` |\r\n',
  });

  assert.deepEqual(checkFile('docs/features/auth/2-tech-spec.md', root).map((f) => f.reason),
    ['dead-link'], 'unconfirmed by a \\r-tailed delimiter, the table lets cell backticks pair');
  assert.deepEqual(checkFile('docs/features/auth/3-architecture.md', root).map((f) => f.reason),
    ['dead-link'], 'the quoted variant fails through the same rejected delimiter');
});

test('CRLF coordinates stay on one text: the entry normalizes before anything measures', () => {
  // The \r bytes before the link shift every downstream offset if any pass reads the raw text
  // while another reads the normalized one — the link then falls off the end of its own masked
  // slice and drowns as unresolved instead of reporting.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'ab\r\ncd\r\n\r\n[x](./ghost.md)\r\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures.map((f) => f.reason), ['dead-link']);
  assert.equal(scan.unresolved, 0, 'nothing here is undecidable — a miscount is a split coordinate system');
});

test('a lone CR is a line ending too: the CR-only table is still a table', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '| a | b |\r| --- | --- |\r| ` | [x](./ghost.md) ` |\r',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures.map((f) => f.reason), ['dead-link'],
    'unnormalized, the document fuses into one line, the cross-cell span erases the link, and the report claims full coverage');
  assert.equal(scan.unresolved, 0);
});

test('inlineMatches normalizes before producing ranges, so the mask covers its own span', () => {
  // Enough CRLF lines shift raw offsets past the code span: ranges made on the normalized copy but
  // applied to the raw block leave the span unmasked, and the code target parses as a live link.
  const block = 'x\r\n'.repeat(20) + '`[x](./code.md)` [y](./live.md)';

  const matches = inlineMatches(block);

  assert.deepEqual(matches.map((m) => m.target), ['./live.md'],
    'the code span stays opaque — reading ./code.md out of it invents a target');
  for (const m of matches) {
    assert.equal(block.slice(m.offset, m.offset + m.target.length), m.target,
      'positions are locations on the block the caller passed, not on the normalized copy');
    assert.equal(block[m.opener], ']', 'the opener index points at the ] the inventory counted');
  }
});

test('remapped positions stay right when CRLF pairs sit between the matches too', () => {
  // Both matches carry a different pair count behind them, so a mapper that miscounts pair
  // positions — or maps only some fields — moves exactly one of the four slices off its target.
  const block = 'x\r\n'.repeat(5) + '[a](./one.md) text\r\n' + 'y\r\n'.repeat(5) + '[b](./two.md)';

  const matches = inlineMatches(block);

  assert.deepEqual(matches.map((m) => m.target), ['./one.md', './two.md']);
  for (const m of matches) {
    assert.equal(block.slice(m.offset, m.offset + m.target.length), m.target);
    assert.equal(block[m.opener], ']');
  }
});

test('the range producers are not part of the public surface', () => {
  // Their coordinates index the normalized text, so an outside composition over raw CRLF input
  // misapplies every range — the exported readers are exactly the ones whose positions are safe.
  const mod = require('../../scripts/check-doc-links');

  assert.equal(mod.blocksOf, undefined);
  assert.equal(mod.opaqueRanges, undefined);
  assert.equal(mod.codeBlockRegions, undefined);
  assert.equal(typeof mod.inlineMatches, 'function', 'the control: coordinate-safe readers stay exported');
  assert.equal(typeof mod.targetsOf, 'function');
  assert.equal(typeof mod.maskRanges, 'function');
});

test('a body containing -- is no comment, so the real opener is the later one', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'a <!-- [x](./ghost.md) <!-- -->\n',
    'docs/features/auth/3-architecture.md': 'a <!-- [x](./ghost.md) --> and [y](./ghost.md)\n',
  });

  const nested = scanFile('docs/features/auth/2-tech-spec.md', root);
  const valid = scanFile('docs/features/auth/3-architecture.md', root);

  assert.deepEqual(nested.failures.map((f) => f.target), ['./ghost.md'],
    'cmark-gfm rejects a comment body holding --, so the link before the inner opener is live');
  assert.equal(nested.unresolved, 0);
  assert.deepEqual(valid.failures.map((f) => f.reason), ['dead-link'],
    'the control: a valid comment still masks its own link, and only the outside one reports');
  assert.equal(valid.unresolved, 0);
});

test('a depth change onto a leaf opener is decisively new, not a lazy continuation', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> paragraph\n# [x](./ghost.md)\nnext [y](./ghost.md)\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures.map((f) => f.reason), ['dead-link', 'dead-link'],
    'lazy continuation extends only a paragraph — a heading ends it by grammar, not by judgment');
  assert.equal(scan.unresolved, 0, 'declining settled work just hands it back to the reviewer');
});

test('laziness only reaches shallower lines: deeper is a new quote, shallower stays declined', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'para\n> [x](./ghost.md)\n',
    'docs/features/auth/3-architecture.md': '>> `\n> [x](./ghost.md) `\n',
  });

  const deeper = scanFile('docs/features/auth/2-tech-spec.md', root);
  const shallower = scanFile('docs/features/auth/3-architecture.md', root);

  assert.deepEqual(deeper.failures.map((f) => f.reason), ['dead-link'],
    'a lazy line omits markers, so a deeper line cannot be one — the quote interrupts, decisively');
  assert.equal(deeper.unresolved, 0);
  assert.deepEqual(shallower.failures, [],
    'the depth-2 paragraph may lazily continue on the depth-1 line, pairing the backticks');
  assert.equal(shallower.unresolved, 1, 'so it is declined — reading it as live invents the finding');
});

test('a comment opened on an indented list-content line is declined like a marker-carried one', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '- x\n  <!--\n- [y](./ghost.md)\n  -->\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [],
    'the sibling item below may or may not be inside the comment — a list model this scanner lacks');
  assert.equal(scan.unresolved, 1, 'declined, so the sibling link cannot silently vanish either way');
});

test('a line where the quote depth changed is a lazy continuation, and is not decided', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> `\n[x](./ghost.md) `\n',
    'docs/features/auth/3-architecture.md': '> text\n\n[x](./ghost.md)\n',
  });

  const lazy = scanFile('docs/features/auth/2-tech-spec.md', root);
  const separated = scanFile('docs/features/auth/3-architecture.md', root);

  assert.deepEqual(lazy.failures, [],
    'the quoted paragraph may continue here, in which case the backticks pair and this is no link');
  assert.equal(lazy.unresolved, 1, 'so it is declined — deciding either way invents the answer');
  assert.deepEqual(separated.failures.map((f) => f.reason), ['dead-link'],
    'the blank line ends the quote outright: without this control the rule could decline everything');
  assert.equal(separated.unresolved, 0);
});

test('a complete tag alone on its line cannot interrupt a paragraph, and a type-6 one can', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'text\n<span id="x">\n[y](./ghost.md)\n',
    'docs/features/auth/3-architecture.md': 'text\n<div>\n[y](./ghost.md)\n',
  });

  const type7 = scanFile('docs/features/auth/2-tech-spec.md', root);
  const type6 = scanFile('docs/features/auth/3-architecture.md', root);

  assert.deepEqual(type7.failures.map((f) => f.reason), ['dead-link'],
    'type 7 opens no block mid-paragraph, so the line below it is ordinary Markdown');
  assert.deepEqual(type6.failures, [], 'type 6 does interrupt, and its content is markup');
  assert.equal(type6.unresolved, 1, 'declined, not dropped');
});

test('a quoted table is a table, so a backtick in one cell cannot reach the next', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> | a | b |\n> | --- | --- |\n> | ` | [x](./ghost.md) ` |\n',
    'docs/features/auth/3-architecture.md': '| a | b |\n| --- | --- |\n| ` | [x](./ghost.md) ` |\n',
  });

  assert.deepEqual(scanFile('docs/features/auth/2-tech-spec.md', root).failures.map((f) => f.reason),
    ['dead-link'], 'unconfirmed, the two cell backticks pair into a span that erases the link');
  assert.deepEqual(scanFile('docs/features/auth/3-architecture.md', root).failures.map((f) => f.reason),
    ['dead-link'], 'the unquoted table is the control: the fix must not be what makes it work');
});

test('a templated fragment on a concrete file still resolves the file', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md':
      '[x](./ghost.md#{SECTION}) [y](./3-architecture.md#{SECTION}) [z]({FEATURE}/a.md)\n',
    'docs/features/auth/3-architecture.md': '# Arch\n',
  });

  const { failures } = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(failures.map((f) => f.reason), ['dead-link'],
    'filtering the whole target as templated skipped a file the checker was asked to resolve');
  assert.match(failures[0].target, /ghost\.md/);
});

test('markdown inside a type-1 raw block is markup, and its link shape is still counted', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md':
      '<pre>\nSee [x](./ghost.md).\n</pre>\n\nAnd [y](./ghost.md).\n',
  });

  const { failures, unresolved } = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(failures.map((f) => f.line), [5],
    'the link outside the block is the control; the one inside it is markup, not a finding');
  assert.equal(unresolved, 1,
    'the shape inside the block went unread, so silence about it would be a false clean bill');
});

test('a blank line ends the HTML block, so the markdown after it is still scanned', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '<details>\n<summary>s</summary>\n\nSee [x](./ghost.md).\n\n</details>\n',
  });

  assert.deepEqual(reasons(checkFile('docs/features/auth/2-tech-spec.md', root)), ['dead-link'],
    'this is how the one HTML block in this repository is actually written');
});

test('a reference definition needs a closed title, or it is not one', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '[a]: ./ghost.md "unterminated\n',
  });
  const junk = repo({
    'docs/features/auth/2-tech-spec.md': '[a]: ./ghost.md "title" and then junk\n',
  });

  assert.deepEqual(checkFile('docs/features/auth/2-tech-spec.md', root), [],
    'an unterminated title means the line never became a definition');
  assert.deepEqual(checkFile('docs/features/auth/2-tech-spec.md', junk), [],
    'and a title may be followed by nothing at all');
});

test('a reference definition with a closed title still resolves', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'Use [a].\n\n[a]: ./ghost.md "title"\n',
  });

  assert.deepEqual(reasons(checkFile('docs/features/auth/2-tech-spec.md', root)), ['dead-link'],
    'the positive control: refusing malformed titles must not refuse well-formed ones');
});

// ── Coverage is reported, not assumed ──────────────────────────────────────

test('an unresolved link shape is counted, so an empty failures list is not read as a clean bill', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'See [x](a(b.md) here.\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'the scanner declined to classify it, so it reports no finding');
  assert.equal(scan.unresolved, 1,
    'and says so — silence here is what made "no failures" read as "every link resolves"');
});

test('a link shape inside a skipped HTML block is counted too', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '<div title="[x](./ghost.md)">\ntext\n</div>\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, []);
  assert.equal(scan.unresolved, 1, 'dropping the block is a coverage gap, and a gap is reportable');
});

test('a document whose links all resolve reports zero unresolved', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': 'See [x](./3-architecture.md).\n',
    'docs/features/auth/3-architecture.md': '# Architecture\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, []);
  assert.equal(scan.unresolved, 0, 'the negative control: the count must mean something when it is 0');
});

// ── Anchors GitHub actually generates ──────────────────────────────────────

test('a title must be separated from its destination', () => {
  assert.deepEqual(inlineTargets('[x](<a.md>"t")'), [],
    'CommonMark requires whitespace here, so resolving a.md invents a dead link');
  assert.deepEqual(inlineTargets('[x](<a.md> "t")'), ['a.md'], 'the positive control');

  // The angle form is where the question arises: a bare destination has no separator to omit, so
  // `./ghost.md"t"` really is one (unusual) filename and resolving it is correct.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '[a]: <./ghost.md>"t"\n' });
  assert.deepEqual(checkFile('docs/features/auth/2-tech-spec.md', root), [],
    'and the same rule holds for a reference definition');
});

test('an escaped pipe does not end a cell', () => {
  // Real line from `skills/create-pr/SKILL.md`: a regex inside a code span inside a table cell.
  // Splitting on the literal character tore the span in half and reported `by\|with` as a link.
  const root = repo({
    'docs/features/auth/2-tech-spec.md':
      '| Tag | Pattern |\n| --- | --- |\n| Generated-by | `Generated[ -](by\\|with).*(Claude)` |\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'the span still closes, so nothing in it is a link');
  assert.equal(scan.unresolved, 0);
});

test('a code span that closes on another line proves nothing, so its `](` is unresolved', () => {
  // The proof rule is narrow on purpose: within one line a code span is unambiguous, but across a
  // newline the container — cell, list item, blockquote — decides, and this scanner does not model
  // containers. Both directions of the newline, because the scan runs outward from the candidate.
  const before = repo({
    'docs/features/auth/2-tech-spec.md': 'Run `git log\n--format=](x.md) --all` first.\n',
  });
  const after = repo({
    'docs/features/auth/2-tech-spec.md': 'Run `git log --format=](x.md)\n--all` first.\n',
  });

  assert.equal(scanFile('docs/features/auth/2-tech-spec.md', before).unresolved, 1,
    'the newline sits before the candidate, so the backward scan is what has to see it');
  assert.equal(scanFile('docs/features/auth/2-tech-spec.md', after).unresolved, 1,
    'and here it sits after it');

  // The negative control: the same span on one line is proven code and costs no coverage.
  const oneLine = repo({
    'docs/features/auth/2-tech-spec.md': 'Run `git log --format=](x.md) --all` first.\n',
  });
  const scan = scanFile('docs/features/auth/2-tech-spec.md', oneLine);
  assert.deepEqual(scan.failures, []);
  assert.equal(scan.unresolved, 0);
});

test('a link inside a multi-line HTML comment is unresolved, never a dead link', () => {
  // Real shape from `skills/adr/references/template.md`: a commented-out template line whose
  // placeholder path resolves to nothing. Classifying it manufactures a finding about a file the
  // template never claimed exists.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': [
      '# Auth',
      '',
      '<!-- When this supersedes an existing decision, add the line below:',
      '> **Supersedes**: [adr-001](./adr-001-old-title.md)',
      '-->',
      '',
      'Body.',
    ].join('\n'),
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [],
    'the comment runs past a blockquote line, so it has to be found as an inline range, not a block');
  assert.equal(scan.unresolved, 0,
    'and proven rather than declined — nothing inside an HTML comment parses as a link');
});

// The round-7 adversarial set. Every case below is an input a reviewer constructed against the
// previous design, and each one failed in one of the two directions that matter: a live link the
// scanner silently lost, or a finding it invented about a construct that is not a link at all.

test('a backtick in the info string opens no fence, so the Markdown under it is still scanned', () => {
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '```bad`info\n[x](missing.md)\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(scan.failures), ['dead-link'],
    'CommonMark forbids a backtick in a backtick fence\'s info string — this is a paragraph');
  assert.equal(scan.unresolved, 0);
});

test('a closing fence carries no info string, so trailing text does not end the block', () => {
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '```\n``` not-a-close\n[x](missing.md)\n```\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'the example is still inside the fence');
  assert.equal(scan.unresolved, 0, 'and a fence is a settled range, so it costs no coverage');
});

test('an indented code block is code; the same line under a paragraph is prose', () => {
  const code = repo({ 'docs/features/auth/2-tech-spec.md': 'para\n\n    [x](missing.md)\n' });
  assert.deepEqual(scanFile('docs/features/auth/2-tech-spec.md', code).failures, [],
    'four spaces after a blank line opens indented code');

  // The negative control, and it is the common case: indented code cannot interrupt a paragraph, so
  // the identical line one blank line later is a lazy continuation and its link is real.
  const prose = repo({ 'docs/features/auth/2-tech-spec.md': 'para\n    [x](missing.md)\n' });
  assert.deepEqual(reasons(scanFile('docs/features/auth/2-tech-spec.md', prose).failures),
    ['dead-link']);
});

test('a code span reaching into a nested list item is counted, not silently dropped', () => {
  // The nested item is a separate container, so its backtick cannot close the parent's span. The
  // scanner does not model that, and the honest answer is to say so.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '- opening `x [x](missing.md) trailing\n    - closes `\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'nothing is established about it');
  assert.equal(scan.unresolved, 1, 'and the candidate reaches the counter rather than vanishing');
});

test('a delimiter row two lines down does not make the block a table', () => {
  // GFM puts the delimiter immediately after the header. Treating a late one as confirmation split
  // the first line into cells, tore the code span at the `|`, and reported its contents as a link.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '| `literal | [x](missing.md)`\nthis is prose\n--- | ---\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'the span is whole, so nothing in it is a link');
  assert.equal(scan.unresolved, 0);

  // The positive control: a real table still splits into cells, which is why the rule exists.
  const table = repo({
    'docs/features/auth/2-tech-spec.md': '| a | b |\n| --- | --- |\n| `x | [y](missing.md)` |\n',
  });
  assert.deepEqual(reasons(scanFile('docs/features/auth/2-tech-spec.md', table).failures),
    ['dead-link'], 'the cell boundary ends the span, so the link in the next cell is real');
});

test('an HTML comment is found wherever it starts, not only at the head of a line', () => {
  const inline = repo({
    'docs/features/auth/2-tech-spec.md': 'Before <!-- [x](missing.md) --> after\n',
  });
  const quoted = repo({ 'docs/features/auth/2-tech-spec.md': '> <!-- [x](missing.md) -->\n' });

  for (const [label, root] of [['mid-line', inline], ['behind a quote marker', quoted]]) {
    const scan = scanFile('docs/features/auth/2-tech-spec.md', root);
    assert.deepEqual(scan.failures, [], `${label}: nothing in a comment parses as a link`);
    assert.equal(scan.unresolved, 0, `${label}: and a comment's extent is settled, so it is proven`);
  }
});

test('an astral character earlier in the document does not shift the mask', () => {
  // Every offset in the scanner is a UTF-16 index; spreading a string splits it by code point, so one
  // emoji above a table moved the mask a unit along and blanked the text beside six live links.
  // Six real README links came back unclassified — coverage lost with nothing to show for it.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': [
      '# 🚀 Auth',
      '',
      '| Scenario | Flow | Docs |',
      '| --- | --- | --- |',
      '| First day | `/project-setup` → `/next-step` | [→](./3-architecture.md) |',
      '',
    ].join('\n'),
    'docs/features/auth/3-architecture.md': '# Architecture\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, []);
  assert.equal(scan.unresolved, 0, 'the link is classified, not lost to an off-by-one mask');
});

test('maskRanges blanks the range it was given, whatever precedes it', () => {
  // The offsets this scanner carries are UTF-16 indices. Spreading a string splits it by code point,
  // so one astral character above the range shifted every blank a unit to the right — the range's
  // first character survived and a character beyond it was destroyed instead.
  const text = '🚀 keep `code` keep';
  const at = text.indexOf('`');

  const masked = maskRanges(text, [{ from: at, to: at + 6, proven: true }]);

  assert.equal(masked.length, text.length, 'length is preserved, or every later offset moves');
  assert.equal(masked.slice(at, at + 6), ' '.repeat(6), 'the range is blank end to end');
  assert.equal(masked[at + 6], text[at + 6], 'and the character after it is untouched');
  assert.equal(masked.slice(0, at), text.slice(0, at), 'as is everything before it');
});

test('a fence carried by a blockquote is code, and what it hides is still counted', () => {
  // The region scan reads container-prefixed fences to find their extent but cannot resolve what is
  // inside one. Excluding those lines from the blocks made the candidate vanish from the inventory
  // instead of reaching the counter — the exact shape the re-scope exists to make impossible.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '> ```\n> [x](missing.md)\n> ```\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'nothing inside a code block is claimed to be a link');
  assert.equal(scan.unresolved, 1, 'and the candidate it hides is reported as unclassified');
});

test('a tab-indented block is indented code, because a tab is four columns', () => {
  // CommonMark expands a leading tab to the next multiple of four, so one tab opens indented code.
  // Measuring the raw character made it one column, the block stayed prose, and the example link
  // inside it was resolved against the filesystem and reported dead.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'para\n\n\t[x](missing.md)\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'an example inside indented code is not a link');
  assert.equal(scan.unresolved, 0, 'and a settled code region needs no declination');
});

test('a type-6 HTML block swallows the list inside it, and the candidate is counted', () => {
  // `<div>` opens a CommonMark type-6 HTML block that runs to the blank line, so the list item inside
  // it is markup this scanner does not parse. Leaving the block out of the inventory dropped the
  // candidate; counting it says what was not answered.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '<div>\n- [x](missing.md)\n</div>\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'nothing inside an unparsed HTML block is claimed to be a link');
  assert.equal(scan.unresolved, 1, 'and the candidate it holds reaches the counter');
});

test('a comment at column zero is a settled range, not an unread block', () => {
  // `<!--` at the start of a line looks like an HTML block opener, and treating it as one sent the
  // candidate down the skipped-block path and counted it unresolved. A comment's extent is proven by
  // its terminator, so the right answer is that there is nothing here to resolve.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '<!-- [x](missing.md) -->\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'a commented-out link is not a link');
  assert.equal(scan.unresolved, 0, 'and a proven range costs no coverage');
});

test('a reference definition a container carries is counted, not silently lost', () => {
  // The definition inventory reads bare lines. A definition indented inside a list item was neither
  // resolved nor counted, so `[x]` above resolved against an empty table and the document reported
  // clean — a false pass, which is the one outcome worse than a declination.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '- opening `\n    - [x]: missing.md\n      closes `\n\nUse [x].\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'no claim is made about a definition shape this cannot read');
  assert.equal(scan.unresolved, 1, 'and it is reported as unread');
});

test('a plain reference definition is still resolved, so the guard above has a control', () => {
  // Delete the container-carried case and this one stays green; delete this one and the counting
  // above would be indistinguishable from declining every definition in the repository.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'Use [x].\n\n[x]: missing.md\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(scan.failures), ['dead-link'], 'an ordinary definition is resolved');
  assert.equal(scan.unresolved, 0, 'and nothing is declined');
});

test('a comment ends at its terminator, so the line below it is still read', () => {
  // A comment is a CommonMark type-2 HTML block: it ends on the line carrying `-->`. Letting it open
  // the *generic* block instead ran it to the next blank line, so the link underneath a one-line
  // comment was swallowed as unread markup and the dead link went unreported.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '<!-- note -->\n[x](missing.md)\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(scan.failures), ['dead-link'], 'the link below the comment is a link');
  assert.equal(scan.unresolved, 0, 'and nothing had to be declined to see it');
});

test('a reference definition inside an unread block is counted, not resolved', () => {
  // A skipped block is markup this scanner does not read; its lines happen to be *shaped* like
  // definitions. Resolving one anyway invents a finding out of an HTML attribute that merely looks
  // like a label — the false direction, which costs a reviewer a chase.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '<div>\n[x]: missing.md\n</div>\n\nUse [x].\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'no claim is made about a line this scanner did not read');
  assert.equal(scan.unresolved, 1, 'it is reported unread instead');
});

test('a reference definition needs no space after the colon, in a container or out of one', () => {
  // CommonMark makes the separator optional. Requiring one meant `> [x]:missing.md` matched neither
  // the strict grammar nor the loose one and left with no exit at all — the definition disappeared
  // from a document that then reported full coverage.
  const quoted = repo({ 'docs/features/auth/2-tech-spec.md': '> [x]:missing.md\n\nUse [x].\n' });
  const listed = repo({ 'docs/features/auth/2-tech-spec.md': '- [x]:missing.md\n\nUse [x].\n' });

  const q = scanFile('docs/features/auth/2-tech-spec.md', quoted);
  const l = scanFile('docs/features/auth/2-tech-spec.md', listed);

  assert.equal(q.unresolved, 1, 'a quoted definition with no separator is counted');
  assert.equal(l.unresolved, 1, 'so is one carried by a list item');
  assert.deepEqual([...q.failures, ...l.failures], [], 'and neither is resolved');
  // The control, and the reason the loose pattern may not simply swallow everything: uncontained,
  // the same line is an ordinary definition and is still resolved.
  const bare = scanFile('docs/features/auth/2-tech-spec.md', repo({
    'docs/features/auth/2-tech-spec.md': '[x]:missing.md\n\nUse [x].\n',
  }));
  assert.deepEqual(reasons(bare.failures), ['dead-link'], 'a plain one resolves as before');
  assert.equal(bare.unresolved, 0, 'with nothing declined');
});

test('a closing fence must match the marker it claims to close', () => {
  // Accepting any quoted fence as the closer ended a ```` block at the ``` inside it, and the link
  // still inside the code came back out as live Markdown and was reported dead — an established
  // finding manufactured from an example.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> ````\n> ```\n> [x](missing.md)\n> ````\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'the shorter run closes nothing, so the link stays inside code');
  assert.equal(scan.unresolved, 1, 'and it is counted as hidden rather than claimed');
});

test('indentation is measured in columns, so a space and a tab reach four', () => {
  // A tab advances to the next multiple of four, so ` \t` is column four and opens indented code.
  // Expanding only a tab run anchored at offset zero left the line as prose and the example inside it
  // was resolved against the filesystem.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': 'para\n\n \t[x](missing.md)\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'an example inside indented code is not a link');
  assert.equal(scan.unresolved, 0, 'and the region is settled, so nothing is declined');
});

test('a generic HTML block opens behind a quote marker too', () => {
  // Testing the bare line meant `> <div>` opened nothing, so the list item under it was read as live
  // Markdown and its example reported dead — a finding invented out of raw HTML inside a blockquote.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> <div>\n> - [x](missing.md)\n> </div>\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'nothing inside the block is claimed to be a link');
  assert.equal(scan.unresolved, 1, 'and the candidate it holds reaches the counter');
});

test('four columns inside a list item is the item, not code, so its link is counted', () => {
  // At the left margin four columns is an indented code block; under a list marker the same
  // indentation is the item's continuation paragraph, which holds real links. Proving it not-a-link
  // dropped a live candidate out of the accounting altogether — the silent direction, and the one
  // the three-way exit exists to make impossible.
  const inList = scanFile('docs/features/auth/2-tech-spec.md', repo({
    'docs/features/auth/2-tech-spec.md': '- item\n\n    [x](missing.md)\n',
  }));

  assert.deepEqual(inList.failures, [], 'no claim is made either way — there is no list model here');
  assert.equal(inList.unresolved, 1, 'and the candidate is reported as unclassified');

  // The control: the same indentation at the margin is genuinely code, and stays proven. Without it
  // this guard would be indistinguishable from declining every indented block in the repository.
  const atMargin = scanFile('docs/features/auth/2-tech-spec.md', repo({
    'docs/features/auth/2-tech-spec.md': 'para\n\n    [x](missing.md)\n',
  }));

  assert.deepEqual(atMargin.failures, [], 'an example in a code block is not a link');
  assert.equal(atMargin.unresolved, 0, 'and needs no declination');
});

test('a fence a list item carries is code, quoted or not', () => {
  // The container rule was written for the quoted fence and stopped there, so `- ``` ` opened
  // nothing and the example inside it was resolved against the filesystem and handed to the reviewer
  // as an established dead link — a finding manufactured out of a code block.
  const listed = scanFile('docs/features/auth/2-tech-spec.md', repo({
    'docs/features/auth/2-tech-spec.md': '- ```\n  [x](missing.md)\n  ```\n',
  }));
  const both = scanFile('docs/features/auth/2-tech-spec.md', repo({
    'docs/features/auth/2-tech-spec.md': '> - ```\n>   [x](missing.md)\n>   ```\n',
  }));

  assert.deepEqual([...listed.failures, ...both.failures], [], 'neither example is claimed as a link');
  assert.equal(listed.unresolved, 1, 'the list-carried fence hides one candidate');
  assert.equal(both.unresolved, 1, 'and so does the one carried by both containers');
});

test('a deeper quote marker inside an open fence is content, not the closer', () => {
  // Stripping *every* `>` made `> > ``` ` look like the fence's own closer, ended the block two lines
  // early, and let the line below out as live Markdown. Only the opener's own prefix is container;
  // markers beyond it belong to the leaf block already open.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> ```\n> > deeper\n> ```\n> [x](missing.md)\n> ```\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  // The link really is outside the fence — line 3 is a paragraph in the quote — so reporting it is
  // right. What the fix changes is *which* line closed the block, and that is what the count shows.
  assert.deepEqual(reasons(scan.failures), ['dead-link'], 'the paragraph below the fence is read');
  assert.equal(scan.unresolved, 0, 'and the fence itself hid no candidate');
});

test('an over-stripped quote marker does not read as a blank line', () => {
  // `> >` inside a `> <div>` block is content. Stripping both markers made it blank, which ended the
  // HTML block early and exposed the list item below it as live Markdown.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> <div>\n> >\n> - [x](missing.md)\n> </div>\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'the block is still open, so nothing inside it is a link');
  assert.equal(scan.unresolved, 1, 'and the candidate it holds is counted');
});

test('a list-carried fence closes at its own content column, not at the document margin', () => {
  // A closing fence may be indented to the container's content column — four spaces under `  - `.
  // Measuring it against the document margin meant the fence never closed, so the region ran to the
  // end of the file and swallowed every later link into the unclassified count.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '  - ```\n    [x](missing.md)\n    ```\n\n[y](gone.md)\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(targets(scan.failures), ['gone.md'], 'the link after the fence is read normally');
  assert.equal(scan.unresolved, 1, 'and only the one inside the fence is counted');
});

test('a fragment names no file, so it leaves the scan without being counted', () => {
  // Heading fragments are out of scope, and a declared boundary is not lost coverage — `#frag` gets
  // the same treatment as an external URL. Counting it would report missing coverage this scanner
  // never promised; resolving it is what eleven review rounds showed it cannot do.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '# Real\n\n[go](#anything-at-all)\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(scan.failures, [], 'no claim is made about the fragment');
  assert.equal(scan.unresolved, 0, 'and none is owed — it is out of scope, not undecided');
});

test('a fragment on a path is checked as a link to that path', () => {
  // The file part still resolves; only the `#…` is dropped. Dropping the whole target would retire
  // the one thing this scanner does well on every cross-document reference in the repository.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '[a](./3-architecture.md#design)\n\n[b](./gone.md#design)\n',
    'docs/features/auth/3-architecture.md': '# Architecture\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(targets(scan.failures), ['./gone.md#design'], 'the missing file is reported');
  assert.deepEqual(reasons(scan.failures), ['dead-link'], 'as a dead link, not a dead fragment');
  assert.equal(scan.unresolved, 0, 'and the one that exists is settled');
});

test('a raw HTML block ends with its container, so the line below the quote is read', () => {
  // CommonMark ends `> <pre>` when the blockquote does. Searching the whole source for `</pre>`
  // consumed the unquoted line between them, so a real link there was masked away and lost.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '> <pre>\n[x](missing.md)\n</pre>\n',
  });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(scan.failures), ['dead-link'], 'the unquoted line is ordinary Markdown');
  assert.equal(scan.unresolved, 0, 'and nothing had to be declined to see it');
});

test('an incomplete tag is a paragraph, so the link below it is a link', () => {
  // Type 7 requires a complete tag alone on its line. Letting the name run to end-of-line made the
  // bare text `<x` open an HTML block, which swallowed the line beneath it into unread markup.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '<x\n[y](missing.md)\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(scan.failures), ['dead-link'], 'the link shares the paragraph with `<x`');
  assert.equal(scan.unresolved, 0, 'and no block was opened to hide it');
});

test('a quoted fence ends with its container, so the line below the quote is read', () => {
  // Consuming "until something looks like a closer" ran out of the blockquote entirely and masked
  // the lines below it, which is coverage lost with nothing reported.
  const root = repo({ 'docs/features/auth/2-tech-spec.md': '> ```\n> code\n[x](missing.md)\n' });

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);

  assert.deepEqual(reasons(scan.failures), ['dead-link'], 'the unquoted line is outside the fence');
  assert.equal(scan.unresolved, 0, 'and the fence itself hid no candidate');
});

test('a target that exists but will not read is still a resolved link', () => {
  // Existence is the whole question now. A file whose contents cannot be read still exists, and
  // reporting it as anything would be a finding about a document nobody opened.
  const root = repo({
    'docs/features/auth/2-tech-spec.md': '[a](./3-architecture.md)\n',
    'docs/features/auth/3-architecture.md': '# Architecture\n',
  });
  fs.chmodSync(path.join(root, 'docs/features/auth/3-architecture.md'), 0o000);

  const scan = scanFile('docs/features/auth/2-tech-spec.md', root);
  fs.chmodSync(path.join(root, 'docs/features/auth/3-architecture.md'), 0o644);

  assert.deepEqual(scan.failures, [], 'the link resolves — the file is there');
  assert.equal(scan.unresolved, 0, 'and its contents were never the question');
});
