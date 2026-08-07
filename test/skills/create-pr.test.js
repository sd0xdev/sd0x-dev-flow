const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/create-pr/SKILL.md');
const stackRefPath = resolve(root, 'skills/create-pr/references/stack-mode.md');

const skillContent = readFileSync(skillPath, 'utf8');
const stackContent = readFileSync(stackRefPath, 'utf8');
const bothContents = `${skillContent}\n${stackContent}`;

/**
 * The single fence scanner every extractor here uses. CommonMark-shaped: a fence
 * opens with 0-3 spaces of indent and three or more backticks or tildes, and
 * closes with at least as many of the same character. Sharing one scanner is the
 * point — a fence that one extractor sees and another misses is a place for a
 * command to hide.
 */
function markdownNodes(content) {
  const nodes = [];
  const lines = content.split('\n');
  let prose = null;
  const flush = () => { if (prose) { nodes.push(prose); prose = null; } };
  // Strip container prefixes (blockquote markers, list bullets) before matching:
  // CommonMark allows a fence to open inside a container, and a fence this
  // scanner does not see is a command no extractor here checks.
  const container = /^(\s*(?:>\s?|[-*+]\s+|\d+[.)]\s+))+/;
  const strip = (line) => line.replace(container, (prefix) => ' '.repeat(Math.min(prefix.length, 3)));
  for (let i = 0; i < lines.length; i += 1) {
    const stripped = strip(lines[i]);
    // A backtick fence's info string may not contain a backtick; a tilde one may.
    const open = stripped.match(/^( {0,3})(`{3,})\s*([^`]*)$/)
      || stripped.match(/^( {0,3})(~{3,})\s*(.*)$/);
    if (!open) {
      if (!lines[i].trim()) { flush(); continue; }
      if (prose) prose.text += `\n${lines[i]}`;
      else prose = { kind: 'prose', text: lines[i], line: i + 1 };
      continue;
    }
    flush();
    const [, indent, marker, info] = open;
    const closer = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !closer.test(strip(lines[j])); j += 1) {
      const line = strip(lines[j]);
      body.push(line.startsWith(indent) ? line.slice(indent.length) : line.replace(/^\s+/, ''));
    }
    nodes.push({
      kind: 'fence',
      lang: info.trim().split(/\s+/)[0],
      text: body.join('\n'),
      line: i + 1,
      span: [i + 1, Math.min(j, lines.length - 1) + 1],
    });
    i = j;
  }
  flush();
  return nodes;
}

/** Bash fences, wherever and however they are fenced */
/**
 * Every fence language a reader would execute, normalized. Keying the sweep on
 * the literal lowercase `bash` left `sh`, `shell`, `zsh` and `BASH` fences
 * outside it entirely: a ```sh fence containing `git push --force origin main`
 * passed every authorization test. Info strings may carry attributes
 * (```bash title=…), so only the first word decides.
 */
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'ksh', 'console', 'shell-session',
  'dash', 'ash', 'fish', 'posix', 'shellscript']);

function fenceLang(node) {
  return (node.lang || '').trim().split(/\s+/)[0].toLowerCase();
}

function bashFences(content) {
  return markdownNodes(content).filter((node) => node.kind === 'fence' && SHELL_LANGS.has(fenceLang(node)));
}

/** Extract a markdown section by heading, up to the next same-or-higher-level heading */
function extractSection(content, heading) {
  const idx = content.indexOf(heading);
  if (idx === -1) return null;
  const level = heading.match(/^#+/)[0].length;
  const afterHeading = content.slice(idx + heading.length);
  // Blank out fenced blocks first: a bash comment at column 0 (`# Layer 1/3 ...`)
  // is not a heading, and treating it as one truncates the section silently.
  // Blank each fence line to spaces of the same width: line count and character
  // offsets both survive, so the index below still points into `content`.
  const fenceLines = new Set();
  for (const node of markdownNodes(afterHeading)) {
    if (node.kind !== 'fence') continue;
    const span = node.text === '' ? 2 : node.text.split('\n').length + 2;
    for (let n = node.line; n < node.line + span; n += 1) fenceLines.add(n);
  }
  const masked = afterHeading
    .split('\n')
    .map((line, n) => (fenceLines.has(n + 1) ? ' '.repeat(line.length) : line))
    .join('\n');
  const nextMatch = masked.search(new RegExp(`^#{1,${level}} `, 'm'));
  return nextMatch !== -1
    ? content.slice(idx, idx + heading.length + nextMatch)
    : content.slice(idx);
}

const stackSection = extractSection(skillContent, '## Stacked PR Mode');

/** Fenced bash blocks that use the allocated run directory, as raw text */
function carriesBodyDir(text) {
  return shellLines(text).some((line) => line.includes('<PR_BODY_DIR>'));
}

/**
 * The stacked execute path removes the run directory in a fence of its own,
 * because its per-layer guarded blocks each clean up only their OWN body file —
 * a layer's private content goes as soon as it is published or fails, and the
 * directory goes once the sequence ends, on the success and failure paths alike.
 */
const TEARDOWN_SHAPE = [
  '(',
  "set -- '<PRIOR_STATUS>'",
  'case "$1" in \'\'|*[!0-9]*) set -- 2 ;; esac',
  'rm -rf -- \'<PR_BODY_DIR>\' || set -- "$1" "$?"',
  'exit "$(( $1 ? $1 : ${2:-0} ))"',
  ')',
];

/**
 * The run directory's teardown. It is the canonical guard with cleanup itself
 * as the operation, so it has no `gh` line — which is why the operation-grammar
 * sweeps treat it as its own class rather than a malformed create/edit block.
 */
function isTeardownFence(text) {
  return JSON.stringify(shellLines(text)) === JSON.stringify(TEARDOWN_SHAPE);
}

/**
 * Sanitization fences. Step 4b and Step 7b invoke a real script on a body or
 * title file, so these carry `<PR_BODY_DIR>` without being guarded operations:
 * they mutate nothing outside the run directory and publish nothing.
 */
// `-p` is part of the form, not decoration: without it bash sources $BASH_ENV
// before the wrapper's first line, and a startup file containing `exit 0` ends
// the run successfully with the sanitizer never invoked.
const SANITIZE_FORM = /^\/bin\/bash -p scripts\/run-skill\.sh create-pr sanitize-pr-content\.sh (title|body|body-inplace|scan) '<PR_BODY_DIR>\/[A-Za-z0-9._-]+'$/;

function isSanitizeFence(text) {
  const lines = shellLines(text);
  return lines.length === 1 && SANITIZE_FORM.test(lines[0]);
}

/**
 * Step 7b's capture fence. `gh pr view` mutates nothing, and its redirect is
 * what makes the scan possible at all — the sanitizer reads files, so output
 * left on the terminal would leave the next command scanning a path that does
 * not exist. It carries `<PR_BODY_DIR>` without being a guarded operation:
 * nothing is published, and the only thing written is inside the freshly
 * allocated verification directory.
 *
 * The target is pinned to a fixed filename so the redirect can never be
 * retargeted at a body file — writing over an input is the truncation hazard
 * that `body-inplace` exists to avoid, and it must not reappear here.
 */
const CAPTURE_FORM = new RegExp(
  '^gh pr view (?:\\d+|<[a-z-]+>) --json title,body '
  + "--template '\\{\\{\\.title\\}\\}\\{\\{\"\\\\n\"\\}\\}\\{\\{\\.body\\}\\}'"
  + " > '<PR_BODY_DIR>/published\\.txt'$"
);

function isCaptureFence(text) {
  const lines = shellLines(text);
  return lines.length === 1 && CAPTURE_FORM.test(lines[0]);
}

function bodyBearingBlocks(content) {
  return bashFences(content)
    .map((node) => node.text)
    .filter((text) => carriesBodyDir(text) && !isTeardownFence(text) && !isSanitizeFence(text)
      && !isCaptureFence(text));
}

/**
 * Fences that do nothing but allocate the run directory. The allocator and the
 * operation live in SEPARATE fences on purpose: one fence holding both has no
 * correct execution. Run it whole and `mktemp -d`'s output is discarded while
 * `gh` receives the un-substituted literal `<PR_BODY_DIR>/…`; run the allocator
 * first and then the same fence "verbatim" and it strands a second directory.
 * A shell comment cannot pause execution while a body is written out of band.
 */
function allocationFences(content) {
  return bashFences(content).filter((node) => {
    const lines = shellLines(node.text);
    return lines.length === 1 && lines[0] === 'mktemp -d';
  });
}

// --- Structure: SKILL.md entry point + references file ---

test('stack mode reference file exists and is linked from SKILL.md', () => {
  assert.ok(existsSync(stackRefPath), 'references/stack-mode.md should exist');
  assert.ok(
    skillContent.includes('references/stack-mode.md'),
    'SKILL.md should point at the detail reference'
  );
});

test('SKILL.md declares a Stacked PR Mode section', () => {
  assert.ok(stackSection, 'SKILL.md should have a "## Stacked PR Mode" section');
  assert.ok(stackSection.includes('--stack'), 'section should document the --stack flag');
});

test('SKILL.md Input line and Arguments list document --stack', () => {
  const inputSection = extractSection(skillContent, '## Input');
  assert.ok(inputSection, 'SKILL.md should have an Input section');
  assert.ok(inputSection.includes('--stack'), 'Input usage line should list --stack');
  assert.match(
    inputSection,
    /`--stack`.*bottom layer first/i,
    'Arguments should state that the chain is given bottom layer first'
  );
});

test('skill frontmatter description mentions stacked PR support', () => {
  const frontmatter = skillContent.slice(0, skillContent.indexOf('---', 3));
  assert.match(
    frontmatter,
    /--stack/,
    'description should surface --stack so the dispatcher can discover it'
  );
});


// --- Authorization boundary (Anchor Register #4) ---

// --- Negative structural assertions (these fail when an unsafe template is introduced) ---

/**
 * Executable-looking lines of ONE raw shell body. Deliberately not
 * self-detecting: the old version guessed "document or fence body?" by looking
 * for a fence marker anywhere in the input, so a body containing a marker in a
 * shell comment (`gh pr close 42 # ```) was re-parsed as Markdown, found no bash
 * fence, and returned no commands at all — the command vanished from every
 * caller that scanned it. Callers now say which they hold.
 */
function shellLines(block) {
  const out = [];
  let heredoc = null;
  let pending = null;
  let open = false; // quote state, carried across a continuation only
  const flush = () => {
    if (pending === null) return;
    out.push(pending);
    const opened = pending.match(/<<-?\s*'([^']+)'/);
    if (opened) heredoc = opened[1];
    pending = null;
    open = false;
  };
  for (const raw of block.split('\n')) {
    if (heredoc !== null) {
      // Inside a heredoc: content is data, and the closing delimiter is not a command.
      if (raw.trim() === heredoc) heredoc = null;
      continue;
    }
    // Comment semantics come FIRST. bash, sh and zsh all treat a trailing
    // backslash inside a comment as comment text, not as a line continuation,
    // so `git fetch --prune origin # harmless \` followed by `gh pr close 42`
    // is two commands. Joining before stripping merged them into one line that
    // then matched an exact allowlist entry with the second command hidden
    // inside the comment.
    const stripped = stripComment(raw.trim(), open);
    open = stripped.open;
    if (!stripped.text) {
      // A comment-only or blank line ends any continuation: no backslash is
      // left to continue with.
      flush();
      continue;
    }
    // A continuation is a trailing backslash that is itself unquoted and
    // unescaped — a `\\` pair at end of line is a literal backslash, not a join.
    const chars = scanShell(stripped.text, open).chars;
    const last = chars[chars.length - 1];
    const continues = Boolean(last) && last.raw === '\\' && !last.quoted && !last.escaped;
    const body = continues ? stripped.text.slice(0, -1).trim() : stripped.text;
    pending = pending === null ? body : `${pending} ${body}`;
    if (!continues) flush();
  }
  flush();
  return out;
}

/** The same, over every bash fence of a whole document */
function bashCommandLines(content) {
  return bashFences(content).flatMap((node) => shellLines(node.text));
}

/** Single-quote renderer exactly as SKILL.md § Command Rendering defines it */
function shellRender(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Split a rendered command with POSIX single-quote + backslash rules. Executes nothing. */
/**
 * THE shell lexer. Every quote-, backslash-, comment- and substitution-aware
 * check in this file is built on this one walker.
 *
 * It exists because the alternative was tried and failed: eight hand-rolled
 * scanners, of which four modelled `\` and four did not, so `'O'\''Brien'$(id)''`
 * was "fully quoted" to one and a live command substitution to the shell.
 * Disagreement between parsers, not any single parser's logic, was the defect.
 *
 * The model is POSIX, with no special case for `'\''`: outside single quotes a
 * backslash escapes the next character, and a raw `'` toggles quoting. The
 * canonical escape falls out of that — close, escaped quote, reopen — which is
 * why it needs no rule of its own.
 *
 * Returns one entry per *logical* character: `raw` is the source text (so a line
 * can be rebuilt losslessly), `ch` is the character the shell sees, `quoted` is
 * the state the character itself is in, `escaped` marks a backslash-escaped
 * character, and `delimiter` marks a quote that opens or closes a run rather
 * than being data.
 */
function scanShell(text, startOpen = false) {
  const chars = [];
  let quoted = startOpen;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!quoted && ch === '\\' && i + 1 < text.length) {
      chars.push({ ch: text[i + 1], raw: ch + text[i + 1], quoted: false, escaped: true, delimiter: false });
      i += 1;
      continue;
    }
    if (ch === "'") {
      quoted = !quoted;
      chars.push({ ch, raw: ch, quoted, escaped: false, delimiter: true });
      continue;
    }
    chars.push({ ch, raw: ch, quoted, escaped: false, delimiter: false });
  }
  return { chars, open: quoted };
}

/**
 * Is `chars[i]` the escaped apostrophe of a canonical `'\''` — that is, does it
 * join two quoted runs rather than merely being escaped somewhere?
 *
 * The distinction is load-bearing. "Any escaped apostrophe is fine" let
 * `gh pr edit 42\'` through: the shell sends the selector `42'`, which `gh`
 * resolves as a BRANCH name rather than PR 42, and git refs may contain an
 * apostrophe. Three call sites need this exact question, so it is asked once.
 */
function isCanonicalJoin(chars, i) {
  const c = chars[i];
  return Boolean(c)
    && c.escaped
    && c.ch === "'"
    && Boolean(chars[i - 1]) && chars[i - 1].delimiter
    && Boolean(chars[i + 1]) && chars[i + 1].delimiter;
}

/** Data characters — quote delimiters removed, escapes resolved */
function shellData(text) {
  return scanShell(text).chars.filter((c) => !c.delimiter).map((c) => c.ch).join('');
}

/** A character the shell acts on: unquoted, unescaped, and not a quote delimiter */
function isOperative(c) {
  return !c.quoted && !c.escaped && !c.delimiter;
}

function tokenize(line) {
  const { chars, open } = scanShell(line);
  const tokens = [];
  let current = '';
  let started = false;
  for (const c of chars) {
    if (c.delimiter) { started = true; continue; }
    if (isOperative(c) && /\s/.test(c.ch)) {
      if (started) { tokens.push(current); current = ''; started = false; }
      continue;
    }
    current += c.ch;
    started = true;
  }
  if (started) tokens.push(current);
  assert.equal(open, false, `rendered command must not end inside an open quote: ${line}`);
  return tokens;
}

test('no command template uses a heredoc at all, whatever the delimiter', () => {
  // A body line equal to the delimiter closes the heredoc early and the rest is
  // parsed as shell input. A random-looking fixed delimiter is no safer than EOF
  // — fixed is fixed — so the contract bans the construct, not one delimiter.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    const templates = bashCommandLines(content).filter((line) => /<</.test(line));
    assert.deepEqual(
      templates,
      [],
      `${name} should contain no heredoc command template, found: ${templates.join(' | ')}`
    );
  }
  assert.match(
    skillContent,
    /no heredoc, ever/,
    'the contract should state the prohibition without an escape hatch'
  );
});

test('a body containing the delimiter cannot terminate anything, because nothing opens one', () => {
  // The regression fixture for the collision vector: a body whose own text is a
  // plausible delimiter followed by a command. With no heredoc in any template,
  // the body never reaches a shell, so the tail stays data by construction.
  const hostileBody = ['## Summary', '', 'PRBODY_7f3a91', 'git push --force origin main', 'EOF'].join('\n');
  const openers = bashCommandLines(bothContents).filter((line) => /<<-?\s*'?[A-Za-z_]/.test(line));
  assert.deepEqual(openers, [], 'no template may open a heredoc');
  for (const bodyLine of hostileBody.split('\n')) {
    assert.ok(
      !bashCommandLines(bothContents).some((cmd) => cmd === bodyLine),
      `body line "${bodyLine}" must never be a command template line`
    );
  }
  // Body reaches gh only as a file path argument.
  const bodyArgs = bashCommandLines(bothContents)
    .flatMap((line) => line.match(/--body-file\s+(\S+)/g) || [])
    .map((m) => m.replace(/--body-file\s+/, ''));
  assert.ok(bodyArgs.length > 0, 'templates should pass a body file');
  for (const arg of bodyArgs) {
    assert.ok(
      /^'[^']*'$/.test(arg) || arg === '"$BODY_FILE"',
      `--body-file must take a quoted path, got: ${arg}`
    );
  }
});

test('no dynamic placeholder reaches a command outside the renderer', () => {
  // The second P0 shape: `git log --oneline <base>..<head>` puts an
  // attacker-chosen ref into an unquoted shell word, so `feat/x;id` executes id.
  // gh-returned integers are the only allowed bare placeholders.
  const NUMERIC_SLOTS = new Set(['<number>', '<PR-number>']);
  const offenders = [];
  for (const line of bashCommandLines(bothContents)) {
    // Blank out every single-quoted literal, then any surviving <...> is bare.
    const outsideQuotes = line.replace(/'[^']*'/g, '');
    for (const placeholder of outsideQuotes.match(/<[^<>]+>/g) || []) {
      if (!NUMERIC_SLOTS.has(placeholder)) offenders.push(`${placeholder} in: ${line}`);
    }
  }
  // `<PRIOR_STATUS>` used to be exempt here, on the reasoning that an
  // arithmetic operand must not be quoted. That was wrong twice over: the
  // substitution in `set -- <PRIOR_STATUS>` is what executes a hostile value —
  // the arithmetic never gets a turn — and `$(( ))` converts a quoted digit
  // string perfectly well. So there is no exemption left, and the digits-only
  // `case` guard downstream is the second layer rather than the only one.
  const statusLines = bashCommandLines(bothContents).filter((l) => l.includes('<PRIOR_STATUS>'));
  assert.deepEqual(
    [...new Set(statusLines)],
    ["set -- '<PRIOR_STATUS>'"],
    'the status placeholder is single-quote rendered like every other value'
  );
  assert.deepEqual(offenders, [], `dynamic values must be single-quote rendered: ${offenders.join(' | ')}`);
});

test('revision ranges are a single-quoted literal, not merely one token', () => {
  // Removing only the quotes still yields one token starting with the ref
  // prefix, so token-shape alone is not the assertion — the source must show a
  // single-quoted literal, and hostile refs must survive substitution.
  const ranges = bashCommandLines(skillContent).filter((line) => /\.\./.test(line));
  assert.ok(ranges.length >= 2, 'Step 1 should still show the commit-range commands');

  for (const line of ranges) {
    const quoted = line.match(/'([^']*\.\.[^']*)'/);
    assert.ok(quoted, `range must appear as a single-quoted literal in the source: ${line}`);
    assert.ok(
      quoted[1].startsWith('refs/remotes/origin/'),
      `range should use fully qualified refs: ${quoted[1]}`
    );

    // Substitute hostile base and head through the documented renderer and
    // re-tokenize: the range must stay exactly one argument.
    const hostileBase = `main;id`;
    const hostileHead = `feat/x$(id)`;
    const mutated = line.replace(
      /'[^']*\.\.[^']*'/,
      shellRender(`refs/remotes/origin/${hostileBase}..refs/remotes/origin/${hostileHead}`)
    );
    const tokens = tokenize(mutated);
    assert.equal(
      tokens.filter((t) => t.includes('..')).length,
      1,
      `the range must remain a single argument: ${mutated}`
    );
    assert.ok(!tokens.includes('id'), 'a hostile ref must not become a command word');
    assert.equal(tokens[0], 'git', 'the command word must not change');
  }
});

test('bodies are delivered by file rather than inline shell interpolation', () => {
  // --body-file is the required form; --body/--body-arg style inline interpolation is not.
  const bodyFlags = bashCommandLines(skillContent).filter((line) => /--body(?!-file)\b/.test(line));
  assert.deepEqual(
    bodyFlags,
    [],
    `commands should use --body-file, found raw --body usage: ${bodyFlags.join(' | ')}`
  );
  assert.ok(
    skillContent.includes('#### Command Rendering'),
    'SKILL.md should carry an explicit Command Rendering contract'
  );
});

test('stack documentation contains no executable push, rebase, or gh stack command', () => {
  const forbidden = bashCommandLines(stackContent).filter((line) =>
    /^(git push|git rebase|gh stack)\b/.test(line)
  );
  assert.deepEqual(
    forbidden,
    [],
    `stack reference must not present these as commands it runs: ${forbidden.join(' | ')}`
  );
});

test('stack mode declares it never executes push, rebase, or gh stack', () => {
  assert.match(
    stackSection,
    /[Nn]ever executes `git push`, `git rebase`, or any `gh stack` subcommand/,
    'SKILL.md must state the non-execution contract verbatim'
  );
  assert.match(
    stackContent,
    /[Nn]ever executes `git push`, `git rebase`, or any `gh stack` subcommand/,
    'reference must carry the same contract'
  );
});

test('stack mode routes branch pushes to the authorized workflow', () => {
  assert.ok(stackSection.includes('/push-ci'), 'SKILL.md should delegate pushes to /push-ci');
  assert.match(
    stackContent,
    /`gh stack init\/add\/submit\/rebase\/push\/modify`.*\|.*user only/s,
    'reference authorization table should mark gh stack commands as user-only'
  );
});

test('stack mode claims no authorization beyond existing gh pr create/edit', () => {
  assert.match(
    stackSection,
    /only `gh pr create` \/ `gh pr edit` run/i,
    'execute mode should be scoped to the pre-existing PR operations'
  );
  assert.match(
    stackSection,
    /Step 5a, Steps 6-7/,
    'should cite the existing authorization contract in create-pr'
  );
});

// --- Phase A: sync classification runs first ---

test('Phase A fetches with --prune before classifying layers', () => {
  assert.ok(
    stackContent.includes('git fetch --prune origin'),
    'reference should specify --prune so stale remote-tracking refs are dropped'
  );
  assert.ok(
    stackSection.includes('git fetch --prune origin'),
    'SKILL.md phase table should state the same fetch'
  );
});

test('generic Step 1 fetches before reading refs/remotes (ls-remote does not update them)', () => {
  // `git ls-remote` only LISTS the server's refs; without a fetch the
  // refs/remotes/origin/* reads below it can be missing or stale, so the PR
  // body would describe old commits — or the workflow would fail outright on
  // a branch this clone never fetched.
  const step1Start = skillContent.indexOf('### 1. Gather Info');
  const step2Start = skillContent.indexOf('### 2. Extract Ticket ID');
  assert.ok(step1Start !== -1 && step2Start > step1Start, 'Step 1 and Step 2 must exist in order');
  const step1 = skillContent.slice(step1Start, step2Start);
  const fetchIdx = step1.indexOf('git fetch --prune origin || exit "$?"');
  const remoteReadIdx = step1.indexOf("git log --oneline 'refs/remotes/origin/");
  assert.ok(fetchIdx !== -1,
    'Step 1 must fetch with Phase A\'s discipline: the exact authorized form plus an explicit '
    + 'exit, so a failed fetch cannot be followed by reads of stale refs');
  assert.ok(remoteReadIdx !== -1, 'fixture premise: Step 1 reads refs/remotes/origin/*');
  assert.ok(fetchIdx < remoteReadIdx,
    'the fetch must precede the first refs/remotes read, or it refreshes nothing');
  assert.match(step1, /^### 1\. Gather Info\s*$/m,
    'the heading itself must carry no parallelism qualifier — the fetch\'s value is its '
    + 'ordering, and prose below the heading is where the parallel batch is scoped');
});

test('stack mode is dispatched before the generic gather/create workflow', () => {
  // Without an early branch, the generic Step 1 would run ls-remote and generate
  // content from local refs before Phase A ever fetches.
  const dispatchIdx = skillContent.indexOf('### 0. Mode Dispatch');
  const gatherIdx = skillContent.indexOf('### 1. Gather Info');
  assert.ok(dispatchIdx !== -1, 'Workflow should open with a mode-dispatch step');
  assert.ok(dispatchIdx < gatherIdx, 'dispatch must precede the generic gather step');
  const dispatch = skillContent.slice(dispatchIdx, gatherIdx);
  assert.match(dispatch, /When `--stack` is present/, 'dispatch should branch on --stack');
  assert.match(dispatch, /Skip generic Steps 1, 5, 6 and 7/, 'generic steps must be skipped in stack mode');
});

test('Phase A is documented as running before chain validation', () => {
  const phaseAIdx = stackContent.indexOf('## Phase A');
  const phaseBIdx = stackContent.indexOf('## Phase B');
  assert.ok(phaseAIdx !== -1 && phaseBIdx !== -1, 'both phases should be documented');
  assert.ok(phaseAIdx < phaseBIdx, 'sync classification must precede chain validation');
  assert.match(
    stackContent,
    /Phase A precedes chain validation/,
    'reference should state why the order matters'
  );
});

test('sync classification enumerates all states including no-such-branch', () => {
  for (const state of ['ABSENT', 'IN_SYNC', 'LOCAL_AHEAD', 'REMOTE_AHEAD', 'DIVERGED', 'NO_SUCH_BRANCH']) {
    assert.ok(stackContent.includes(state), `reference should define the ${state} sync state`);
  }
});

test('sync classification uses bidirectional ancestry, not OID equality alone', () => {
  // local≠remote is ambiguous across LOCAL_AHEAD / REMOTE_AHEAD / DIVERGED.
  assert.match(
    stackContent,
    /needs ancestry in \*\*both\*\* directions/,
    'reference should state that both directions are required'
  );
  const matrix = stackContent.slice(stackContent.indexOf('| local_oid | remote_oid |'));
  assert.match(matrix, /is-ancestor local remote/, 'matrix should test local→remote');
  assert.match(matrix, /is-ancestor remote local/, 'matrix should test remote→local');
  assert.match(matrix, /\| no \| yes \| `LOCAL_AHEAD`/, 'remote-is-ancestor means local ahead');
  assert.match(matrix, /\| yes \| no \| `REMOTE_AHEAD`/, 'local-is-ancestor means remote ahead');
  assert.match(matrix, /\| no \| no \| `DIVERGED`/, 'neither direction means diverged');
});

test('refs are fully qualified and resolution errors fail closed', () => {
  assert.match(stackContent, /'refs\/heads\/[^']+'/, 'local ref should be fully qualified and single-quote rendered');
  assert.match(stackContent, /refs\/remotes\/origin\/<head>/, 'remote ref should be fully qualified');
  assert.match(
    stackContent,
    /\*\*fail closed\*\*: report and stop, never treat an error as "absent"/,
    'errors must not be misread as an absent branch'
  );
});

test('a branch that exists nowhere aborts instead of routing to push remediation', () => {
  const row = stackContent
    .split('\n')
    .find((line) => line.trim().startsWith('| `NO_SUCH_BRANCH`'));
  assert.ok(row, 'disposition table should have a NO_SUCH_BRANCH row');
  assert.match(row, /abort/, 'should abort');
  assert.match(row, /pushing cannot fix a typo/, 'should explain why push is not the remedy');
});

test('sync classification compares OIDs rather than trusting ls-remote', () => {
  assert.match(
    stackContent,
    /rev-parse --verify --quiet 'refs\/remotes\/origin\/[^']+'/,
    'reference should read the remote OID explicitly'
  );
  assert.match(
    stackContent,
    /`git ls-remote` proves only that a remote branch exists, never that it matches local/,
    'reference should explain why ls-remote is insufficient'
  );
});

test('ABSENT layers stop before PR planning and emit push remediation', () => {
  assert.match(
    stackContent,
    /`ABSENT`.*stop before PR planning.*push remediation/s,
    'reference disposition table should stop ABSENT layers early'
  );
  assert.match(
    stackSection,
    /`ABSENT`.*stop before PR planning/s,
    'SKILL.md sync table should carry the same disposition'
  );
});

test('LOCAL_AHEAD continues only in dry-run and is refused under --execute', () => {
  const row = stackSection
    .split('\n')
    .find((line) => line.trim().startsWith('| `LOCAL_AHEAD`'));
  assert.ok(row, 'SKILL.md sync table should have a LOCAL_AHEAD row');
  assert.match(row, /warning/i, 'dry-run should warn about stale content');
  assert.match(row, /refuse/i, 'execute mode should refuse');
});

test('REMOTE_AHEAD and DIVERGED are not remediated by pushing', () => {
  const row = stackSection
    .split('\n')
    .find((line) => line.trim().startsWith('| `REMOTE_AHEAD`'));
  assert.ok(row, 'SKILL.md sync table should have a REMOTE_AHEAD / DIVERGED row');
  assert.match(row, /fetch\/rebase/, 'remedy should be fetch/rebase by the user');
  assert.match(row, /push is not the remedy/i, 'should state push is not the fix for this state');
});

// --- Phase B: chain validation ---

test('every layer including the bottom is validated against its own base', () => {
  // A layer 1 that diverged from the target branch, with layers 2-3 correctly
  // stacked on it, passes adjacent-pair checks alone — hence the per-layer check.
  assert.ok(
    stackContent.includes("git merge-base --is-ancestor 'refs/remotes/origin/<base>' 'refs/remotes/origin/<head>'"),
    'reference should validate each layer against its declared base'
  );
  assert.match(
    stackContent,
    /bottom layer'?s?\*?\*? check is not optional/i,
    'reference should call out the bottom layer explicitly'
  );
  assert.match(
    stackContent,
    /non-empty `git log base\.\.head` does not prove descent/,
    'reference should explain why the commit-range check is insufficient'
  );
  assert.match(
    stackSection,
    /bottom layer included/,
    'SKILL.md phase table should carry the bottom-layer requirement'
  );
});

test('chain validation uses real ancestry rather than list order', () => {
  assert.ok(
    stackContent.includes("git merge-base --is-ancestor 'refs/remotes/origin/<lower>' 'refs/remotes/origin/<upper>'"),
    'reference should specify the ancestry command'
  );
  assert.match(
    stackContent,
    /comparing declared list order against itself would prove nothing/,
    'reference should explain why list order is not a validation'
  );
});

test('existing-PR lookup queries all states, not just open, and past the first page', () => {
  // `gh pr list` defaults to --limit 30. The policy rejects any conflicting
  // match, so a conflict on page 2 would be read as "absent" — the premise the
  // whole chain is then built on.
  assert.ok(
    stackContent.includes("gh pr list --head '<head>' --state all --limit 100 --json number,baseRefName,state"),
    'reference should query with --state all, an explicit --limit, and the needed JSON fields'
  );
  assert.match(
    stackContent,
    /defaults to open-only, so `--state all` is mandatory/,
    'reference should justify the flag'
  );
  assert.ok(
    stackSection.includes('--state all'),
    'SKILL.md phase table should carry the flag requirement'
  );
});

test('existing-PR policy rejects closed, merged, base-mismatched, and multiple matches', () => {
  const policy = stackContent.slice(stackContent.indexOf('**Existing-PR policy'));
  assert.match(policy, /OPEN with `baseRefName` equal to the chain's declared base/, 'policy should require matching open PR');
  assert.match(policy, /Multiple matches, `CLOSED`, `MERGED`, or a base mismatch all abort/, 'all four rejection cases should abort');
});

test('layer-count rules cover empty, single, normal, and oversized chains', () => {
  const table = stackContent.slice(stackContent.indexOf('| Layer count | Behavior |'));
  assert.match(table, /empty, no arguments.*auto-detection/s, 'empty + no args enters auto-detection');
  assert.match(table, /empty, explicit arguments.*error/s, 'empty + explicit args is an error');
  assert.match(table, /\| 1 \|.*plain `\/create-pr`/s, 'single layer should defer to plain /create-pr');
  assert.match(table, /> 5.*warn, continue/s, 'over five layers warns but continues');
});

test('auto-detection stops on ambiguity instead of guessing a base', () => {
  assert.match(
    stackContent,
    /authoritative sources only/i,
    'auto-detection should be restricted to authoritative sources'
  );
  assert.match(
    stackContent,
    /a git branch does not record its intended base/i,
    'reference should explain why branches alone are insufficient'
  );
  assert.match(stackContent, /ambiguity STOPs rather than guesses/, 'ambiguity must stop');
});

test('dirty working tree warns but does not block', () => {
  assert.match(
    stackContent,
    /dirty working tree \*\*warns but never blocks\*\*/,
    'reference should state the non-blocking rule'
  );
  assert.match(
    stackSection,
    /dirty working tree only warns/i,
    'SKILL.md should carry the same rule'
  );
});

// --- Shell safety (hostile input) ---

test('shell safety contract names the metacharacters git actually accepts', () => {
  const safety = stackContent.slice(stackContent.indexOf('## Shell Safety'));
  for (const meta of ['`;`', '`$( )`', '`&`']) {
    assert.ok(safety.includes(meta), `shell-safety contract should cover ${meta}`);
  }
  assert.match(safety, /a leading `-` is rejected by that check/, 'leading dash claim should stay accurate');
  assert.match(safety, /`--` so an option-like value is never parsed as a flag/, 'option terminator rationale should be present');
});

test('displayed commands are escaped and use an option terminator', () => {
  assert.match(
    stackContent,
    /single-quote rendered/,
    'dynamic display values should be single-quote escaped'
  );
  assert.ok(
    stackContent.includes("git push origin -- 'b1' 'b2' 'b3'"),
    'the emitted push command should demonstrate the -- terminator and quoting'
  );
});

test('body is treated as a dynamic field that never enters shell syntax', () => {
  const safety = stackContent.slice(stackContent.indexOf('## Shell Safety'));
  assert.match(safety, /Body text never enters shell syntax/i, 'body must be in the safety contract');
  assert.match(
    safety,
    /no heredoc, in any form/,
    'heredocs should be forbidden outright, not merely discouraged'
  );
  assert.match(
    safety,
    /a fixed "random-looking" delimiter is no safer than `EOF`/,
    'reference should explain why a random-looking fixed delimiter is not a fix'
  );
  assert.match(safety, /--body-file/, 'temp-file fallback should be offered');
});

test('skill-executed commands avoid shell string interpolation', () => {
  assert.match(
    stackContent,
    /passed as argument arrays, never interpolated into a shell string/,
    'execution path should use argument arrays'
  );
});

// --- Phase C: markers, fail-fast, re-entry ---

test('dependency marker uses the PR number whenever it is known', () => {
  const markerTable = stackContent.slice(stackContent.indexOf('| Situation | Marker in body |'));
  assert.match(markerTable, /dry-run, lower PR already exists.*#<N>/s, 'known number is used even in dry-run');
  assert.match(markerTable, /dry-run, lower PR absent.*lower head branch/s, 'branch marker only when absent');
  assert.match(markerTable, /`--stack --update`.*upgrade any leftover branch marker to `#<N>`/s, 'update upgrades markers');
});

test('no unresolved placeholder is ever emitted', () => {
  assert.match(
    bothContents,
    /Never emit an unresolved placeholder/,
    'both documents should forbid placeholder output'
  );
});

test('failure is fail-fast with per-layer status and no atomicity claim', () => {
  assert.match(stackSection, /partial success is a real outcome/, 'partial success should be acknowledged');
  assert.match(
    stackSection,
    /succeeded \/ failed \/ pending/,
    'per-layer status reporting should be specified'
  );
  assert.ok(
    !/atomic(?!ity)/i.test(stackSection.replace(/not atomic|no atomicity claim/gi, '')),
    'stack mode should not promise atomic behavior'
  );
});

test('re-running routes already-created layers to update mode', () => {
  assert.match(
    stackContent,
    /Re-running detects already-created layers in Phase B and routes them to update mode/,
    'reference should specify the re-entrant path'
  );
  assert.match(stackContent, /nothing is created twice/, 'duplicate creation should be excluded');
});

test('per-layer PRs still run the AI sanitization steps', () => {
  assert.match(
    stackContent,
    /Steps 2-4 plus Step 4b sanitization/,
    'each layer should run title/body sanitization'
  );
  assert.match(
    stackContent,
    /Step 7b post-creation verify per layer/,
    'execute mode should post-verify each layer'
  );
});

// --- Phase D: environment detection and degradation ---

test('environment detection matches the extension identity, not a loose substring', () => {
  assert.match(
    stackContent,
    /match the github\/gh-stack identity, not a loose "stack" substring/,
    'reference should require exact extension matching'
  );
});

test('missing gh-stack degrades with an explicit message and fallback', () => {
  const phaseD = stackContent.slice(stackContent.indexOf('## Phase D'));
  assert.match(phaseD, /emit the message below verbatim/, 'degradation message should be explicit');
  assert.match(phaseD, /gh-stack extension not installed — falling back to Multi-PR mode/, 'the user-facing message should be shipped');
  assert.match(phaseD, /fall back to the existing Multi-PR behavior/, 'fallback path should be named');
  assert.match(phaseD, /mode-appropriate dependency markers/, 'fallback should keep the marker contract');
});

test('native stack equivalence is not overclaimed', () => {
  const phaseD = stackContent.slice(stackContent.indexOf('## Phase D'));
  assert.match(phaseD, /GitHub stack object/, 'native-only benefit should be named');
  assert.match(
    phaseD,
    /is not claimed to be equivalent/,
    'hand-built chained-base PRs should not be claimed equivalent to a native stack'
  );
});

test('rollout detection degrades conservatively while its signal is unconfirmed', () => {
  assert.match(
    stackContent,
    /detection failure degrades conservatively to the non-native path/,
    'unknown rollout state should fall back rather than assume support'
  );
});

// --- Flag interactions ---

test('--title is rejected and --head is mutually exclusive in stack mode', () => {
  const interaction = stackContent.slice(stackContent.indexOf('| Flag interaction | Behavior |'));
  assert.match(interaction, /`--title`.*rejected/s, '--title should be rejected in stack mode');
  assert.match(interaction, /`--head`.*mutually exclusive with `--stack`/s, '--head should be mutually exclusive');
  assert.match(interaction, /`--base`.*bottom layer only/s, '--base should apply to the bottom layer only');
});

test('bottom-layer base follows the same resolution as normal mode', () => {
  // Hard-coding main would target the wrong branch in a repo configured for develop.
  const interaction = stackContent.slice(stackContent.indexOf('| Flag interaction | Behavior |'));
  assert.match(
    interaction,
    /`--base` → `\{TARGET_BRANCH\}` → `main`/,
    'base resolution order should match the main contract'
  );
  assert.match(interaction, /Never hard-code `main`/, 'reference should forbid hard-coding main');
  assert.ok(
    !/base: main for layer_1/.test(stackContent),
    'the chain model should not pin layer 1 to main'
  );
});

test('--update in stack mode requires every layer to exist and never creates', () => {
  const interaction = stackContent.slice(stackContent.indexOf('| Flag interaction | Behavior |'));
  assert.match(interaction, /all-existing precondition/, '--update should assert all layers exist');
  assert.match(interaction, /`--update` must never create/, '--update must not create PRs');
  assert.match(
    stackContent,
    /Phase B aborts before reaching here if any layer is absent/,
    'Phase C should state the abort happens earlier'
  );
  assert.match(
    stackSection,
    /`--update` never creates/,
    'SKILL.md should carry the same precondition'
  );
});

test('installed extension alone does not unlock the native path', () => {
  // Rollout has no confirmed signal, so "installed" must still degrade conservatively.
  const phaseD = stackContent.slice(stackContent.indexOf('## Phase D'));
  assert.match(
    phaseD,
    /unknown \(no confirmed signal[^)]*\).*conservative non-native path/s,
    'unknown rollout should take the conservative path even when installed'
  );
  assert.match(
    phaseD,
    /"extension installed" alone never unlocks the native output/,
    'reference should state the rule explicitly'
  );
});

test('frontmatter allows the tool that execute-mode approval requires', () => {
  const frontmatter = skillContent.slice(0, skillContent.indexOf('---', 3));
  assert.match(
    frontmatter,
    /allowed-tools:.*AskUserQuestion/,
    'execute-mode confirmation needs AskUserQuestion pre-approved, as in /push-ci'
  );
});

test('stacked mode verification checklist covers the load-bearing contracts', () => {
  const checklist = extractSection(skillContent, '### Stacked mode (`--stack`)');
  assert.ok(checklist, 'Verification should include a stacked-mode checklist');
  assert.match(checklist, /No `git push`, `git rebase`, or `gh stack` subcommand executed/, 'non-execution should be verified');
  assert.match(checklist, /--state all/, 'PR query flag should be verified');
  assert.match(checklist, /re-run created no duplicates/, 're-entrancy should be verified');
  assert.match(checklist, /no heredoc anywhere, body passed via `--body-file`/, 'heredoc safety should be verified');
});

// --- Scenario coverage: the documented rules applied to concrete fixtures ---
// These read the contract tables out of the docs and *execute* them against
// realistic inputs, so a table edited into an inconsistent state fails here
// rather than passing a prose match.

/** Parse a markdown table whose header row contains `headerCell`, into row cell arrays */
function parseTable(content, headerCell) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.includes(headerCell) && line.trim().startsWith('|'));
  if (start === -1) return [];
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith('|'); i += 1) {
    rows.push(lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  }
  return rows;
}

/** Build a sync classifier from the reference's bidirectional-ancestry matrix */
function syncClassifier() {
  const rows = parseTable(stackContent, '| local_oid | remote_oid |');
  assert.ok(rows.length >= 7, 'ancestry matrix should enumerate every state combination');
  const oidMatches = (spec, self, other) => {
    if (spec === 'absent') return self === '';
    if (spec === 'present') return self !== '';
    if (spec === 'equal') return self !== '' && self === other;
    if (spec === '≠') return self !== '' && other !== '' && self !== other;
    return false;
  };
  const boolMatches = (spec, value) => spec === '—' || (spec === 'yes') === value;
  return (local, remote, localIsAncestor, remoteIsAncestor) => {
    const hit = rows.find(
      (r) =>
        oidMatches(r[0], local, remote) &&
        oidMatches(r[1], remote, local) &&
        boolMatches(r[2], localIsAncestor) &&
        boolMatches(r[3], remoteIsAncestor)
    );
    return hit ? hit[4].match(/`([A-Z_]+)`/)[1] : null;
  };
}

/**
 * Builds a real repository with a real `origin`, one branch per sync state, and
 * returns the sandbox. This is what the table-only Phase A tests could not do:
 * they derived a classifier from the reference and checked it against the same
 * reference, so a probe command that cannot run — `git rev-parse --verify
 * --quiet -- 'refs/heads/x'` returns 1 for a ref that EXISTS, because `--` is
 * rev-parse's rev/path separator, not an option terminator — looked correct in
 * every assertion while classifying every layer as absent.
 */
function buildSyncFixture() {
  const sandbox = mkdtempSync(join(tmpdir(), 'create-pr-sync-'));
  const work = join(sandbox, 'work');
  const originPath = join(sandbox, 'origin.git');
  // Plumbing only. `git add`, `git commit`, `git push` and `git reset --hard`
  // are Anchor Register #4's closed list (rules/discretion.md) and a test
  // fixture cannot write itself an exception — so the graph is built with
  // hash-object / mktree / commit-tree / update-ref, none of which are on it.
  // The side benefit is hermeticity: no user hooks, no commit signing and no
  // `user.email` dependency.
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };
  const runIn = (cwd, args, input) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env, input });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const git = (args, input) => runIn(work, args, input);

  mkdirSync(work);
  spawnSync('git', ['init', '-b', 'main', work], { encoding: 'utf8', env });

  const commit = (label, parent) => {
    const blob = git(['hash-object', '-w', '--stdin'], `${label}\n`);
    const tree = git(['mktree'], `100644 blob ${blob}\tfile.txt\n`);
    const args = ['commit-tree', tree, '-m', label];
    if (parent) args.splice(2, 0, '-p', parent);
    return git(args);
  };

  const c0 = commit('base');
  const inSync = commit('in-sync', c0);
  const first = commit('first', c0);
  const second = commit('second', first);
  const localSide = commit('local side', c0);
  const remoteSide = commit('remote side', c0);
  const neverPushed = commit('never pushed', c0);

  // Each row is one documented sync state, as the pair of OIDs that must end up
  // on the local side and on the server. `null` means "this ref does not exist".
  const STATES = [
    ['main', c0, c0],
    ['in-sync', inSync, inSync],
    ['local-ahead', second, first],
    ['remote-ahead', first, second],
    ['diverged', localSide, remoteSide],
    ['absent', neverPushed, null],
    ['remote-only', null, inSync],
  ];

  // Every OID has to exist locally first, so the bare clone below carries the
  // objects the server side needs — including the ones only it will keep.
  for (const [name, local, remote] of STATES) {
    git(['update-ref', `refs/heads/${name}`, local || remote]);
    if (remote && remote !== local) git(['update-ref', `refs/heads/__seed-${name}`, remote]);
  }

  // A real bare remote, so `git fetch --prune origin` in the shipped fence is
  // the real command rather than one the test had to delete. `clone` is not on
  // Anchor Register #4's list and does not mutate the source.
  runIn(sandbox, ['clone', '--bare', '--quiet', work, originPath]);
  for (const [name, local, remote] of STATES) {
    if (remote) runIn(originPath, ['update-ref', `refs/heads/${name}`, remote]);
    else runIn(originPath, ['update-ref', '-d', `refs/heads/${name}`]);
    if (remote && remote !== local) runIn(originPath, ['update-ref', '-d', `refs/heads/__seed-${name}`]);
  }
  git(['remote', 'add', 'origin', originPath]);
  git(['fetch', '--prune', '--quiet', 'origin']);
  // Now the local side, including the refs that must NOT exist locally.
  for (const [name, local] of STATES) {
    if (local) git(['update-ref', `refs/heads/${name}`, local]);
    else git(['update-ref', '-d', `refs/heads/${name}`]);
    git(['update-ref', '-d', `refs/heads/__seed-${name}`]);
  }

  return { work, env, originPath, cleanup: () => rmSync(sandbox, { recursive: true, force: true }) };
}

/** The ref-resolution probe exactly as the reference ships it. */
function shippedProbe(kind) {
  const line = bashCommandLines(stackContent).find(
    (l) => l.startsWith('git rev-parse --verify --quiet') && l.includes(`refs/${kind}`)
  );
  assert.ok(line, `Phase A should ship a ${kind} probe`);
  return line;
}

test('the shipped Phase A probe resolves refs that exist in a real repository', () => {
  // The single assertion the `--` defect could not survive. Run, do not match.
  const fx = buildSyncFixture();
  try {
    const resolve1 = (probe, ref) => {
      const command = probe.replace(/'refs\/[^']*'/, shellRender(ref));
      return spawnSync('/bin/sh', ['-c', command], { cwd: fx.work, encoding: 'utf8' });
    };
    // The guard is what makes absence non-fatal, so the exit statuses that
    // distinguish present from absent are only observable on the bare probe.
    const bare = (line) => line.replace(/\s*\|\|\s*\[.*$/, '');
    // NB: `bare` strips from the FIRST `||`, so it removes the trailing
    // `|| exit 2` along with the not-found test — which is what makes the raw
    // statuses observable below.
    const local = bare(shippedProbe('heads'));
    const remote = bare(shippedProbe('remotes'));
    assert.match(
      shippedProbe('heads'),
      /\|\| \[ "\$\?" = 1 \] \|\| exit 2$/,
      'the shipped probe must accept "not found" and exit on anything else'
    );

    const present = resolve1(local, 'refs/heads/in-sync');
    assert.equal(present.status, 0, `an existing local ref must resolve, got ${present.status}`);
    assert.match(present.stdout.trim(), /^[0-9a-f]{40}$/, 'the probe must print the OID it resolved');

    const absent = resolve1(local, 'refs/heads/no-such-branch');
    assert.equal(absent.status, 1, 'a missing ref must be distinguishable from a present one');
    assert.equal(absent.stdout.trim(), '', '--quiet must print nothing for a missing ref');

    const remotePresent = resolve1(remote, 'refs/remotes/origin/in-sync');
    assert.equal(remotePresent.status, 0, 'an existing remote-tracking ref must resolve');
    assert.notEqual(
      present.stdout.trim(),
      '',
      'present and absent must not collapse to the same observable outcome'
    );
  } finally {
    fx.cleanup();
  }
});

test('the shipped Phase A fence classifies every sync state, verbatim, against a real remote', () => {
  // Run the fence exactly as shipped — including `git fetch --prune origin`,
  // against a real bare remote — and read the labelled output. Deleting the
  // fetch to make the test run is what let a fetch-failure defect survive.
  const fence = bashFences(stackContent)
    .map((n) => n.text)
    .find((t) => t.includes('git fetch --prune origin'));
  assert.ok(fence, 'Phase A should ship the probe fence');

  const fx = buildSyncFixture();
  try {
    const forBranch = (branch) => fence
      .split('\n')
      .map((line) => line
        .replace(/'refs\/heads\/[^']*'/, shellRender(`refs/heads/${branch}`))
        .replace(/'refs\/remotes\/origin\/[^']*'/, shellRender(`refs/remotes/origin/${branch}`)))
      .join('\n');

    // Parse the labelled regions the fence emits: an empty region is "absent".
    const classify = (stdout) => {
      const lines = stdout.split('\n');
      const at = (label) => lines.indexOf(label);
      const [l, r, e] = ['local:', 'remote:', 'end:'].map(at);
      assert.ok(l !== -1 && r !== -1 && e !== -1, `fence output must carry all three markers:\n${stdout}`);
      const region = (from, to) => lines.slice(from + 1, to).filter(Boolean);
      return { local: region(l, r), remote: region(r, e) };
    };

    // The four combinations the labels exist to separate. `absent` (local only)
    // and `remote-only` produce one OID each — indistinguishable without them.
    const EXPECTED = {
      'in-sync': [1, 1],
      'local-ahead': [1, 1],
      'remote-ahead': [1, 1],
      diverged: [1, 1],
      absent: [1, 0],
      'remote-only': [0, 1],
      'no-such-branch': [0, 0],
    };
    for (const [branch, [wantLocal, wantRemote]] of Object.entries(EXPECTED)) {
      const r = spawnSync('/bin/sh', ['-c', forBranch(branch)], { cwd: fx.work, encoding: 'utf8' });
      assert.equal(r.status, 0, `Phase A aborted on '${branch}': ${r.stderr}`);
      const got = classify(r.stdout);
      assert.equal(got.local.length, wantLocal, `'${branch}': wrong local-ref verdict`);
      assert.equal(got.remote.length, wantRemote, `'${branch}': wrong remote-ref verdict`);
      for (const oid of [...got.local, ...got.remote]) {
        assert.match(oid, /^[0-9a-f]{40}$/, `'${branch}': a region must hold an OID or nothing`);
      }
    }

    // ABSENT and remote-only must not collapse onto the same observation —
    // their dispositions are opposites.
    const absent = classify(spawnSync('/bin/sh', ['-c', forBranch('absent')], { cwd: fx.work, encoding: 'utf8' }).stdout);
    const remoteOnly = classify(spawnSync('/bin/sh', ['-c', forBranch('remote-only')], { cwd: fx.work, encoding: 'utf8' }).stdout);
    assert.notDeepEqual(
      [absent.local.length, absent.remote.length],
      [remoteOnly.local.length, remoteOnly.remote.length],
      'ABSENT and remote-only must be distinguishable from the fence output alone'
    );
  } finally {
    fx.cleanup();
  }
});

test('a failed fetch aborts Phase A instead of classifying stale refs', () => {
  // The defect this shape closes: with a bare command list and no caller
  // errexit, a failed fetch is followed by probes that read stale
  // remote-tracking refs, and the fence reports success.
  const fence = bashFences(stackContent)
    .map((n) => n.text)
    .find((t) => t.includes('git fetch --prune origin'));
  const fx = buildSyncFixture();
  try {
    const broken = fence
      .replace('git fetch --prune origin', 'git fetch --prune no-such-remote')
      .replace(/'refs\/heads\/[^']*'/, shellRender('refs/heads/in-sync'))
      .replace(/'refs\/remotes\/origin\/[^']*'/, shellRender('refs/remotes/origin/in-sync'));

    // Shipped shape: aborts, and never reaches the end marker.
    const shipped = spawnSync('/bin/sh', ['-c', broken], { cwd: fx.work, encoding: 'utf8' });
    assert.notEqual(shipped.status, 0, 'a failed fetch must abort the fence');
    assert.doesNotMatch(shipped.stdout, /end:/, 'an aborted classification must not look complete');

    // Negative control: drop the explicit exit and the defect returns — stale
    // refs resolve and the block reports success. `set -e` is deliberately NOT
    // what is stripped here: it is no longer in the fence, because a caller
    // that tests the fence's status disables errexit inside it (POSIX, measured
    // in bash/sh/zsh/dash), so it could never have been the guard this control
    // is measuring.
    const unguarded = broken.replace(' || exit "$?"', '');
    const bad = spawnSync('/bin/sh', ['-c', unguarded], { cwd: fx.work, encoding: 'utf8' });
    assert.equal(bad.status, 0, 'the control must reproduce the defect, or it proves nothing');
    assert.match(bad.stdout, /[0-9a-f]{40}/, 'the control must resolve a stale ref');
  } finally {
    fx.cleanup();
  }
});

test('the shipped ancestry fence reports both directions and refuses to classify an error', () => {
  // The fence is executed as shipped, not simulated: the earlier matrix test
  // calls `git merge-base` itself and collapses its status to `status === 0`,
  // which is exactly the reading that cannot tell 1 ("no") from 128 ("could
  // not answer"). Only running the fence can catch it returning 0 on 128.
  const fence = bashFences(stackContent)
    .map((n) => n.text)
    .find((t) => t.includes('local-is-ancestor-of-remote:'));
  assert.ok(fence, 'Phase A should ship the ancestry fence');

  const fx = buildSyncFixture();
  try {
    const forRefs = (local, remote) => fence
      .replace(/'refs\/heads\/[^']*'/g, shellRender(local))
      .replace(/'refs\/remotes\/origin\/[^']*'/g, shellRender(remote));
    const statuses = (stdout) => {
      const lines = stdout.split('\n');
      const after = (label) => lines[lines.indexOf(label) + 1];
      return [after('local-is-ancestor-of-remote:'), after('remote-is-ancestor-of-local:')];
    };

    // The three unequal states plus the equal one — 0 is "yes", 1 is "no".
    const EXPECTED = {
      'in-sync': ['0', '0'],
      'local-ahead': ['1', '0'],
      'remote-ahead': ['0', '1'],
      diverged: ['1', '1'],
    };
    for (const [branch, want] of Object.entries(EXPECTED)) {
      const cmd = forRefs(`refs/heads/${branch}`, `refs/remotes/origin/${branch}`);
      const r = spawnSync('/bin/sh', ['-c', cmd], { cwd: fx.work, encoding: 'utf8' });
      assert.equal(r.status, 0, `ancestry fence aborted on '${branch}': ${r.stderr}`);
      assert.match(r.stdout, /end:/, `'${branch}' is a real classification and must complete`);
      assert.deepEqual(statuses(r.stdout), want, `'${branch}': wrong ancestry pair`);
    }

    // A ref that does not exist makes `--is-ancestor` exit 128, which is not an
    // answer. Shipped shape: abort, and never reach the completion marker.
    const bad = forRefs('refs/heads/no-such-branch', 'refs/remotes/origin/in-sync');
    const shipped = spawnSync('/bin/sh', ['-c', bad], { cwd: fx.work, encoding: 'utf8' });
    assert.notEqual(shipped.status, 0, 'a 128 must abort the classification');
    assert.doesNotMatch(shipped.stdout, /end:/, 'an aborted classification must not look complete');

    // Negative control: drop the status re-raise and the fail-open returns —
    // 128 is captured, printed as if it were an answer, and the fence exits 0.
    const unguarded = bad.split('\n').filter((l) => !l.includes('[ "$1" = 0 ]')).join('\n');
    const control = spawnSync('/bin/sh', ['-c', unguarded], { cwd: fx.work, encoding: 'utf8' });
    assert.equal(control.status, 0, 'the control must reproduce the defect, or it proves nothing');
    assert.match(control.stdout, /end:/, 'the control must claim a completed classification');
    assert.deepEqual(statuses(control.stdout), ['128', '128'], 'the control must print the raw error status');
  } finally {
    fx.cleanup();
  }
});

test('both Phase A fences fail closed in every available shell, including a status-tested caller', () => {
  // The defect this closes is invisible to a test that only invokes the fence
  // DIRECTLY. `set -e` inside the subshell cannot carry the policy: errexit is
  // disabled for a command whose status the caller tests, and that context is
  // inherited into the subshell. Measured in bash, sh, zsh and dash alike —
  // `f || true` around `( set -e; false; echo REACHED )` prints REACHED and
  // exits 0 in every one, and the shipped fence's `set -e` variant aborts when
  // invoked directly but leaks stale OIDs under a status-tested caller. It is
  // POSIX behaviour, not one shell's quirk, so both halves matter here: every
  // shell on the box, and the calling context that disables errexit.
  const shells = ['/bin/sh', '/bin/bash', '/bin/zsh'].filter((sh) => existsSync(sh));
  assert.ok(shells.length >= 2, 'this box should offer more than one shell to test against');

  const fences = bashFences(stackContent).map((n) => n.text);
  const probe = fences.find((t) => t.includes('git fetch --prune origin'));
  const ancestry = fences.find((t) => t.includes('local-is-ancestor-of-remote:'));
  assert.ok(probe && ancestry, 'Phase A should ship both fences');

  const fx = buildSyncFixture();
  try {
    // Each case: a fence given something it cannot answer, and the completion
    // marker it must NOT reach.
    const CASES = [
      {
        what: 'a fetch against an unreachable remote',
        // Stale remote-tracking refs are present, so an unguarded fence happily
        // resolves them and reports success.
        cmd: probe
          .replace('git fetch --prune origin', 'git fetch --prune no-such-remote')
          .replace(/'refs\/heads\/[^']*'/, shellRender('refs/heads/in-sync'))
          .replace(/'refs\/remotes\/origin\/[^']*'/, shellRender('refs/remotes/origin/in-sync')),
      },
      {
        what: 'an ancestry probe on a ref that does not exist',
        cmd: ancestry
          .replace(/'refs\/heads\/[^']*'/g, shellRender('refs/heads/no-such-branch'))
          .replace(/'refs\/remotes\/origin\/[^']*'/g, shellRender('refs/remotes/origin/in-sync')),
      },
    ];

    for (const { what, cmd } of CASES) {
      for (const sh of shells) {
        // The status-tested caller: the fence's status is consumed by `||`,
        // which is exactly the context in which zsh stops applying errexit.
        const wrapper = `f() {\n${cmd}\n}\nf || echo "outer=$?"\n`;
        const r = spawnSync(sh, ['-c', wrapper], { cwd: fx.work, encoding: 'utf8' });
        assert.doesNotMatch(
          r.stdout,
          /end:/,
          `${sh}: ${what} must not reach the completion marker\n${r.stdout}`
        );
        assert.match(
          r.stdout,
          /outer=[1-9]/,
          `${sh}: ${what} must hand a failing status to the caller\n${r.stdout}`
        );
      }
    }

    // Negative control, run in the same shells: with the explicit exits removed
    // the defect must come back — otherwise the loop above proves nothing about
    // which line is doing the work.
    if (existsSync('/bin/zsh')) {
      const unguarded = CASES.map(({ cmd }) => cmd.replace(/ \|\| exit ("\$\?"|2)/g, ''));
      for (const cmd of unguarded) {
        const r = spawnSync('/bin/zsh', ['-c', `f() {\n${cmd}\n}\nf || echo "outer=$?"\n`], {
          cwd: fx.work,
          encoding: 'utf8',
        });
        assert.match(r.stdout, /end:/, 'the control must claim a completed classification');
        assert.doesNotMatch(r.stdout, /outer=[1-9]/, 'the control must report success to its caller');
      }
    }
  } finally {
    fx.cleanup();
  }
});

test('the documented ancestry matrix classifies real repository states correctly', () => {
  // The matrix is the thing under test; the expectations below are stated
  // independently of it, and the inputs come from git rather than from prose.
  // A wrong row now produces a wrong label on real data instead of agreeing
  // with itself.
  const fx = buildSyncFixture();
  try {
    const classify = syncClassifier();
    const run = (...args) => spawnSync('git', args, { cwd: fx.work, encoding: 'utf8' });
    const oid = (ref) => {
      const r = run('rev-parse', '--verify', '--quiet', ref);
      return r.status === 0 ? r.stdout.trim() : '';
    };
    const isAncestor = (a, b) => run('merge-base', '--is-ancestor', a, b).status === 0;

    const expected = {
      'in-sync': 'IN_SYNC',
      'local-ahead': 'LOCAL_AHEAD',
      'remote-ahead': 'REMOTE_AHEAD',
      diverged: 'DIVERGED',
      absent: 'ABSENT',
      'remote-only': 'IN_SYNC',
      'no-such-branch': 'NO_SUCH_BRANCH',
    };

    for (const [name, want] of Object.entries(expected)) {
      const local = oid(`refs/heads/${name}`);
      const remote = oid(`refs/remotes/origin/${name}`);
      const got = classify(
        local,
        remote,
        Boolean(local && remote) && isAncestor(local, remote),
        Boolean(local && remote) && isAncestor(remote, local)
      );
      assert.equal(got, want, `branch ${name}: real git state classified as ${got}, expected ${want}`);
    }
  } finally {
    fx.cleanup();
  }
});

test('a realistic three-layer chain classifies each layer per the ancestry matrix', () => {
  // Arrange — auth stack on develop: layer 1 pushed, layer 2 local-only, layer 3 a typo.
  const classify = syncClassifier();
  const chain = [
    { head: 'feat/auth-schema', local: 'a1'.repeat(20), remote: 'a1'.repeat(20) },
    { head: 'feat/auth-service', local: 'b2'.repeat(20), remote: '' },
    { head: 'feat/auth-apii', local: '', remote: '' },
  ];

  // Act
  const states = chain.map((l) => classify(l.local, l.remote, false, false));

  // Assert
  assert.deepEqual(states, ['IN_SYNC', 'ABSENT', 'NO_SUCH_BRANCH']);
  assert.equal(
    classify('c3'.repeat(20), 'd4'.repeat(20), false, true),
    'LOCAL_AHEAD',
    'remote being an ancestor of local is LOCAL_AHEAD'
  );
  assert.equal(classify('c3'.repeat(20), 'd4'.repeat(20), true, false), 'REMOTE_AHEAD');
  assert.equal(classify('c3'.repeat(20), 'd4'.repeat(20), false, false), 'DIVERGED');
});

test('dependency markers resolve per situation across a three-layer chain', () => {
  // Arrange — dry-run over the same stack; only the bottom layer has a PR yet.
  //
  // ⚠️ The source of the expectations and the thing under test are the same
  // table, so this cannot prove the *policy* is right — only that the table
  // states one marker per situation, that no situation is missing, and that no
  // row leaves an unresolved placeholder. The circularity is broken one level
  // up: the expected marker strings below are written out literally rather than
  // read from the row, so rewriting the table's content fails this test even
  // though the table is also its input.
  const rows = parseTable(stackContent, '| Situation | Marker in body |');
  const markerFor = (situation) => {
    const hit = rows.find((r) => r[0].toLowerCase().includes(situation));
    assert.ok(hit, `marker table should cover: ${situation}`);
    return hit[1];
  };

  // Act
  const bottomExists = markerFor('lower pr already exists');
  const bottomAbsent = markerFor('lower pr absent');

  // Assert — number when known, branch name when not, never a placeholder.
  assert.match(bottomExists, /Stacked on #<N>/, 'layer above an existing PR cites its number');
  assert.match(bottomAbsent, /Stacked on `<lower head branch>`/, 'otherwise it cites the branch');
  for (const row of rows) {
    assert.ok(
      !/TBD|TODO|\{\{|<placeholder>/i.test(row[1]),
      `marker must never be an unresolved placeholder: ${row[1]}`
    );
  }
  assert.match(markerFor('--update'), /#<N>/, 'update upgrades branch markers to numbers');
});

test('a second-layer failure reports per-layer status and re-entry creates no duplicate', () => {
  const phaseC = extractSection(stackContent, '## Phase C');
  assert.match(phaseC, /Fail-fast, no atomicity/, 'partial success must be stated as a real outcome');
  assert.match(phaseC, /stop before the next layer/, 'layer 3 must not be attempted after layer 2 fails');
  for (const status of ['succeeded', 'failed', 'pending']) {
    assert.ok(phaseC.includes(status), `per-layer report should distinguish "${status}"`);
  }
  // Re-entry: the already-created bottom layer is detected in Phase B and updated, not recreated.
  assert.match(
    phaseC,
    /Re-running detects already-created layers in Phase B and routes them to update mode, so nothing is created twice/,
    'recovery is re-entrancy, not a local state file'
  );
  assert.ok(
    !/state file|\.create-pr-state|resume token/i.test(stackContent),
    'no local run state should be introduced — GitHub is the state store'
  );
});

test('hostile branch names and bodies cannot break out of a rendered command', () => {
  // Arrange — the escaping rule SKILL.md mandates, applied to the SHIPPED template
  // rather than to a helper invented by this test.
  const hostile = `feat/x'; rm -rf / ; echo $(id) '`;
  const template = bashCommandLines(stackContent).find((line) =>
    line.startsWith('git rev-parse --verify --quiet')
  );
  assert.ok(template, 'Phase A should ship a rev-parse template');

  // Act — substitute the hostile branch into the shipped template through the
  // documented renderer, then re-parse the result with POSIX quoting rules.
  const rendered = template.replace(/'refs\/heads\/[^']*'/, shellRender(`refs/heads/${hostile}`));
  const tokens = tokenize(rendered);

  // Assert — the payload survives as exactly one argument; nothing detaches,
  // and the not-found guard stays literal rather than absorbing the payload.
  assert.deepEqual(tokens.slice(0, 5), ['git', 'rev-parse', '--verify', '--quiet', `refs/heads/${hostile}`]);
  assert.deepEqual(tokens.slice(5), ['||', '[', '"$?"', '=', '1', ']', '||', 'exit', '2']);
  assert.ok(!tokens.some((t) => /^(push|rebase|stack|rm|id)$/.test(t)), 'no injected command word');

  // A body line equal to the heredoc delimiter is the other half of the same
  // vector — closed off by never embedding the body in the command at all.
  const inlineBody = bashCommandLines(bothContents).filter((line) => /--body(?!-file)\b/.test(line));
  assert.deepEqual(inlineBody, [], 'body must always travel by file, never inline');
  assert.match(
    skillContent,
    /--body-file '<PR_BODY_DIR>\/pr-body-\d+\.md'/,
    'templates should pass the body as a file path in the allocated directory'
  );
});

test('no shipped template lets a dynamic value reach the shell unquoted', () => {
  // Double quotes do not suppress $( ), so a double-quoted ref is the P0 shape.
  const offenders = bashCommandLines(bothContents).filter((line) =>
    /"refs\//.test(line) || /"origin\//.test(line) || /\$\(printf/.test(line)
  );
  assert.deepEqual(offenders, [], `dynamic values must be single-quote rendered: ${offenders.join(' | ')}`);
  assert.match(
    skillContent,
    /Double quotes are \*\*not\*\* a substitute/,
    'the rendering contract should state why double quotes fail'
  );
});

/**
 * Replace each complete single-quoted literal of a line, treating the POSIX
 * escape `'\''` as part of the literal it sits in rather than as a close
 * followed by a reopen. A naive /'[^']*'/ splits `'O'\''Brien'` into two
 * literals and leaves a bare backslash behind, which made the hostile-value
 * test reject the exact rendering shellRender is required to emit.
 */
function replaceQuotedLiterals(line, replacement) {
  const { chars } = scanShell(line);
  let out = '';
  let literal = false;
  for (const [i, c] of chars.entries()) {
    // A canonical literal is a run of quoted characters, plus the escaped
    // quotes that join two such runs — that is exactly shellRender's output.
    const inside = c.quoted || c.delimiter || isCanonicalJoin(chars, i);
    if (inside) {
      if (!literal) { out += replacement(); literal = true; }
      continue;
    }
    literal = false;
    out += c.raw;
  }
  return out;
}

/**
 * One complete canonical rendered literal: quoted runs joined only by `'\''`,
 * and nothing else. `/^'.+'$/` accepted `'O'\''Brien'$(id)''` because it starts
 * and ends with an apostrophe — while the shell runs `id`.
 */
function isCanonicalLiteral(word) {
  const { chars, open } = scanShell(word);
  if (open || chars.length < 3) return false;
  if (!chars[0].delimiter || !chars[chars.length - 1].delimiter) return false;
  let content = 0;
  for (const [i, c] of chars.entries()) {
    if (c.quoted && !c.delimiter) { content += 1; continue; }
    if (c.delimiter) continue;
    // The only permitted unquoted character is the escaped quote that joins
    // two runs, and it must be surrounded by the delimiters it joins.
    if (!isCanonicalJoin(chars, i)) return false;
    content += 1;
  }
  return content > 0;
}

test('the operation grammar rejects hostile commands and accepts the contract rendering', () => {
  // Driving the grammar directly, not only the helpers it calls. Asserting
  // `isCanonicalLiteral(breakout) === false` proves the helper works; it does
  // not prove the grammar still *uses* it. Reverting either helper to its
  // pre-fix form passes every document-derived test, because no shipped command
  // contains an apostrophe — these fixtures are what make the revert fail.
  const ESCAPE = "'" + '\\' + "'" + "'";
  const rendered = "'fix: O" + ESCAPE + "Brien base'";

  const REJECTED = [
    ["gh pr edit 42 --title 'O" + ESCAPE + "Brien'$(id)''", 'substitution after a closed literal'],
    ["gh pr edit 42 --title='O" + ESCAPE + "Brien'$(id)''", 'the same, as an attached value'],
    ['gh pr edit 42\\X --title ' + rendered, 'an escaped character in the selector'],
    // `gh pr edit` takes a branch as well as a number, and a git ref may contain
    // an apostrophe — so this selects the PR for branch `42'`, not PR 42. It is
    // the one escaped character that "any escaped apostrophe is fine" allowed.
    ["gh pr edit 42\\' --title " + rendered, 'an escaped apostrophe in the selector'],
    ["gh pr edit 42 --head\\' --title " + rendered, 'an escaped apostrophe in a flag'],
    // Retargets the PR. No contract path edits a base outside the guard —
    // whether it is the only field or hidden behind a plausible title edit.
    ["gh pr edit 42 --base 'develop'", 'a base-only edit'],
    ["gh pr edit 42 --base 'release' --title " + rendered, 'a retarget disguised as a title edit'],
    // Decoded, these read as the number 42; the shell sends `42evil` and `42'`,
    // and `gh pr edit` resolves a non-numeric selector as a branch name.
    ["gh pr edit 42'evil' --title " + rendered, 'a quoted selector that decodes to a number'],
    ["gh pr edit 42''" + ESCAPE + "'' --title " + rendered, 'the same, spelled with empty runs'],
    ["gh pr edit 42 '--title' " + rendered, 'a quoted flag name'],
    ['gh pr edit 42 --title ' + rendered + ' --repo ' + "'other/repo'", 'a flag that redirects the target'],
    ['gh pr create --fill', 'a create that selects nothing and sanitizes nothing'],
    // Fully-formed except for one extra valueless flag. Listing `--draft` and
    // `--fill` as "known" authorized exactly this: every required flag present,
    // every value canonically rendered, and a materially different PR opened.
    [
      "gh pr create --head 'feat/x' --base 'main' --title 'safe' "
        + "--body-file '<PR_BODY_DIR>/pr-body-1.md' --draft",
      'a well-formed create carrying an undeclared valueless flag',
    ],
    [
      "gh pr create --head 'feat/x' --base 'main' --title 'safe' "
        + "--body-file '<PR_BODY_DIR>/pr-body-1.md' --fill",
      'the same, with --fill',
    ],
    ['gh pr create --draft', 'the same, interactively'],
    ['gh pr edit 42', 'an edit that changes no field'],
    ["gh pr edit 42 --title ''", 'an empty value'],
    ['gh pr edit 42 --title ' + rendered + ' --title ' + rendered, 'a flag given twice'],
    // Reached only by the literal grammar: no substitution, no redirection and
    // no escape, so every other guard passes it. The unquoted `*` between two
    // quoted runs is a glob the shell expands against the working directory.
    ["gh pr edit 42 --title 'release '*' notes'", 'an unquoted glob between two quoted runs'],
    ["gh pr edit 42 --title='release '*' notes'", 'the same, as an attached value'],
  ];
  for (const [command, why] of REJECTED) {
    assert.throws(
      () => assertPrOperation('fixture', command, { requireAll: false }),
      `the grammar must reject ${why}: ${command}`
    );
  }

  const ACCEPTED = [
    ['gh pr edit 42 --title ' + rendered, { requireAll: false }],
    ['gh pr edit 42 --title=' + rendered, { requireAll: false }],
    ["gh pr edit 42 --body-file '<PR_BODY_DIR>/pr-body-1.md'", { requireAll: true }],
    ["gh pr create --head 'feat/x' --base 'main' --title " + rendered
      + " --body-file '<PR_BODY_DIR>/pr-body-2.md'", { requireAll: true }],
  ];
  for (const [command, options] of ACCEPTED) {
    assert.doesNotThrow(
      () => assertPrOperation('fixture', command, options),
      `the grammar must accept the contract's own rendering: ${command}`
    );
  }

  // And the helper's own positive direction, which no document exercises.
  assert.equal(hasUnquotedBackslash('118\\X'), true, 'an escaped character must be detected');
  assert.equal(hasUnquotedBackslash('--head\\X'), true);
  assert.equal(hasUnquotedBackslash("42\\'"), true, 'an escaped apostrophe outside a join is not canonical');
  assert.equal(hasUnquotedBackslash("'a'" + '\\' + "''b'"), false, 'the join itself stays legal');
  assert.equal(isCanonicalLiteral("''"), false, 'an empty literal carries no value');
  assert.equal(isCanonicalLiteral("'a'"), true);
});

test("shellRender's own output survives every parser, and a near-miss does not", () => {
  // Without this, reverting the escape-aware parsers to a naive /'[^']*'/ would
  // pass: no shipped command currently contains an apostrophe, so the documents
  // alone never exercise the sequence the contract requires shellRender to emit.
  const ESCAPE = "'" + '\\' + "'" + "'";
  const rendered = shellRender("O'Brien");
  assert.equal(rendered, "'O" + ESCAPE + "Brien'", 'shellRender must emit the canonical POSIX escape');

  // Safe: one complete literal to every parser, and the data round-trips.
  assert.equal(isCanonicalLiteral(rendered), true, 'the canonical rendering must be a complete literal');
  assert.equal(hasUnquotedBackslash(rendered), false, 'the canonical escape is the one legal unquoted backslash');
  assert.equal(unquotedSubstitution(rendered), false);
  assert.equal(unquotedRedirection(rendered), false);
  assert.deepEqual(commandWords(rendered), [rendered], 'the escape must not split the word');
  assert.deepEqual(tokenize(rendered), ["O'Brien"], 'the shell sees the original value back');
  assert.equal(shellData(rendered), "O'Brien");
  assert.deepEqual(unquotedRuns(rendered), [], 'nothing in it is unquoted data');
  assert.equal(replaceQuotedLiterals(`gh pr edit 42 --title ${rendered}`, () => "'X'"), "gh pr edit 42 --title 'X'");

  // Breakout: the shell closes the literal before `$(id)` and runs it. It ends
  // with an apostrophe and starts with one, which is all `/^'.+'$/` ever asked.
  const breakout = "'O" + ESCAPE + "Brien'$(id)''";
  assert.match(breakout, /^'.+'$/, 'the discarded check would have accepted this');
  assert.equal(isCanonicalLiteral(breakout), false, 'a reopened run after a substitution is not one literal');
  assert.equal(unquotedSubstitution(breakout), true, 'the substitution is outside every quoted run');
  assert.equal(hasUnquotedBackslash(breakout), false, 'and it hides behind a legitimate-looking escape');

  // A trailing backslash inside a comment is comment text in bash, sh and zsh —
  // it must not continue the line and swallow the next command. Verified in all
  // three shells: `echo FIRST # c \` + `echo SECOND` prints both.
  assert.deepEqual(
    shellLines("git fetch --prune origin # harmless \\\ngh pr close 42"),
    ['git fetch --prune origin', 'gh pr close 42'],
    'a comment must not continue a line'
  );
  // A comment may also begin right after a control operator, with no space.
  // Same three shells, same result — so these are two commands, not one.
  for (const operator of [';', '&&', '||', '|', '&', ')']) {
    assert.deepEqual(
      shellLines(`git fetch --prune origin${operator}# harmless \\\ngh pr close 42`),
      [`git fetch --prune origin${operator}`, 'gh pr close 42'],
      `a comment after \`${operator}\` must not continue a line`
    );
  }
  // A `#` that is not at a word start is data, not a comment.
  assert.deepEqual(
    shellLines("gh pr view 42 --json title#notacomment"),
    ['gh pr view 42 --json title#notacomment'],
    'a mid-word hash is not a comment'
  );
  assert.deepEqual(
    shellLines("gh pr edit 42 --title 'release # 3'"),
    ["gh pr edit 42 --title 'release # 3'"],
    'a quoted hash is data'
  );
});

test('every shipped command survives hostile substitution without gaining a command word', () => {
  // Render a hostile value into every single-quoted literal of every shipped
  // command line; the command word must never change and no separator appear.
  const hostile = `x'; git push --force origin main; echo '`;
  // '(' / ')' delimit the subshell that carries the captured status; `set` seeds
  // and captures it in the positional parameters and `exit` re-raises it.
  // `echo` earns its place only for the fixed region markers Phase A emits;
  // it never carries a dynamic value, which the hostile substitution below
  // is what proves. `[` is the status re-raise in Phase A's ancestry fence —
  // it compares a captured status against fixed literals, so hostile input
  // cannot reach it either.
  const allowedHeads = new Set(['git', 'gh', 'mktemp', 'rm', '(', ')', 'set', 'exit', 'echo', 'bash', '/bin/bash', '[', 'case']);
  for (const line of bashCommandLines(bothContents)) {
    if (line.startsWith('<') || line.endsWith('\\')) continue;
    const mutated = replaceQuotedLiterals(line, () => shellRender(hostile));
    const tokens = tokenize(mutated);
    if (!tokens.length) continue;
    assert.ok(
      allowedHeads.has(tokens[0]) || tokens[0].includes('='),
      `unexpected command word "${tokens[0]}" in: ${line}`
    );
    assert.ok(
      !tokens.slice(1).some((t) => t === 'push' || t === 'rebase' || t === 'stack'),
      `hostile value must not become a subcommand in: ${line}`
    );
  }
});

test('a three-layer chain emits create/edit per layer with a chained base', () => {
  // Arrange — routing comes from the doc's own layer-state table, so an edited
  // table changes the expectation rather than silently passing.
  const routing = parseTable(stackContent, '| Layer state | Command | Base argument |');
  const commandFor = (state) => {
    const hit = routing.find((r) => r[0].toLowerCase().includes(state));
    assert.ok(hit, `routing table should cover state: ${state}`);
    return hit[1];
  };
  assert.match(commandFor('no pr'), /gh pr create --head '<head>' --base '<base>'/);
  // An existing PR is edited WITHOUT `--base`. Phase B admits a layer only when
  // its PR is already open on the declared base, so resending it can never set
  // a base it does not already have — the only state it can reach is one Phase
  // B never saw: a base a human retargeted in between. Resending would silently
  // revert that. Setting the base belongs to `create`; for an existing PR it is
  // an invariant this mode checks, not a field it writes.
  assert.match(commandFor('base matches'), /gh pr edit <number>(?! --base)/);
  assert.doesNotMatch(commandFor('base matches'), /--base/, 'an edit must not resend the base');

  // Act — read the worked example's actual emitted commands.
  // The layers are &&-chained into one joined command line — split them back out.
  const chain = bodyBearingBlocks(stackContent).find((block) => block.includes('&&'));
  assert.ok(chain, 'the dry-run worked example should still be an &&-chained block');
  const example = shellLines(chain)
    .flatMap((l) => l.split(/\s*&&\s*/))
    .map((seg) => seg.trim())
    .filter((seg) => /^gh pr (create|edit)/.test(seg));
  const pairs = example.map((l) => ({
    head: (l.match(/--head '([^']+)'/) || [])[1],
    base: (l.match(/--base '([^']+)'/) || [])[1],
  }));

  // Assert — bottom layer targets the resolved branch, each layer above sits on
  // the one below, and nothing targets a hard-coded `main`.
  assert.equal(pairs.length, 3, 'the worked example should show all three layers');
  assert.deepEqual(pairs[0], { head: 'feat/auth-schema', base: 'develop' });
  assert.deepEqual(pairs[1], { head: 'feat/auth-service', base: 'feat/auth-schema' });
  // The top layer is an `edit`, and it carries no base at all — the chained
  // base was established when that PR was created.
  assert.equal(pairs[2].base, undefined, 'the edited layer must not resend a base');
  assert.match(example[2], /^gh pr edit 118 /, 'the top layer of the example is an edit');
  assert.ok(
    !pairs.some((p) => p.base === 'main'),
    'the example must not fall back to a hard-coded main'
  );
});

test('a second-layer failure halts the chain and a re-run creates no duplicate', () => {
  // Arrange — a tiny executor over the documented Phase C rules: bottom-to-top,
  // create when Phase B found no PR, update when it did, stop on first failure.
  //
  // ⚠️ This is a **simulator**, and what it proves is bounded accordingly. The
  // skill's per-layer sequencing is executed by the model reading Phase C, not
  // by a shipped script, so there is nothing here to invoke the way the fence
  // tests invoke a fence. `runChain` therefore models the documented rules and
  // checks that they compose into the stated outcomes (halt on failure, no
  // duplicate on re-run) — it cannot detect a Phase C that says something
  // different from what is modelled here. The document-side assertions in this
  // file's Phase C tests are what hold the prose to these rules; keep the two
  // in step when either changes.
  const runChain = (layers, github) => {
    const calls = [];
    const status = new Map(layers.map((l) => [l.head, 'pending']));
    for (const layer of layers) {
      const existing = github.prs[layer.head];
      const verb = existing ? 'edit' : 'create';
      calls.push({ verb, head: layer.head, base: layer.base });
      const result = github.respond(layer.head, verb);
      if (result === 'error') {
        calls[calls.length - 1].ok = false;
        status.set(layer.head, 'failed');
        break;
      }
      calls[calls.length - 1].ok = true;
      if (verb === 'create') github.prs[layer.head] = result;
      status.set(layer.head, 'succeeded');
    }
    return { calls, status };
  };
  const layers = [
    { head: 'feat/auth-schema', base: 'develop' },
    { head: 'feat/auth-service', base: 'feat/auth-schema' },
    { head: 'feat/auth-api', base: 'feat/auth-service' },
  ];
  const github = {
    prs: {},
    failOnce: new Set(['feat/auth-service']),
    respond(head) {
      if (this.failOnce.has(head)) { this.failOnce.delete(head); return 'error'; }
      return 100 + Object.keys(this.prs).length + 1;
    },
  };

  // Act — first run fails at layer 2; the user retries.
  const first = runChain(layers, github);
  const second = runChain(layers, github);

  // Assert — layer 3 is never attempted after layer 2 fails, statuses are
  // distinguishable, and the re-run updates layer 1 instead of recreating it.
  assert.deepEqual(first.calls.map((c) => c.head), ['feat/auth-schema', 'feat/auth-service']);
  assert.deepEqual(
    [...first.status.values()],
    ['succeeded', 'failed', 'pending'],
    'per-layer report must distinguish succeeded / failed / pending'
  );
  assert.equal(second.calls[0].verb, 'edit', 're-run must update the already-created bottom layer');
  assert.deepEqual([...second.status.values()], ['succeeded', 'succeeded', 'succeeded']);
  // A failed create created nothing — only successful ones can duplicate.
  const creates = [...first.calls, ...second.calls].filter((c) => c.verb === 'create' && c.ok);
  assert.equal(
    new Set(creates.map((c) => c.head)).size,
    creates.length,
    'no branch may be created twice across the failure and the re-run'
  );
});

test('the degradation path names the missing component and how to install it', () => {
  const phaseD = extractSection(stackContent, '## Phase D');
  assert.match(phaseD, /gh extension install github\/gh-stack/, 'install command should be given');
  assert.match(phaseD, /Missing: github\/gh-stack/, 'the missing component should be named');
  assert.match(phaseD, /falling back to Multi-PR mode/, 'the fallback should be stated to the user');
});

test('the run directory is allocated by mktemp, not invented', () => {
  // An invented path is never created, so Write fails on the missing parent —
  // and on a shared /tmp a predictable name can be pre-created or symlinked.
  const bodyPaths = bashCommandLines(bothContents)
    .flatMap((line) => line.match(/--body-file '[^']+'/g) || [])
    .map((m) => m.replace(/--body-file '/, '').replace(/'$/, ''));
  assert.ok(bodyPaths.length >= 4, 'templates should name concrete body-file paths');
  for (const path of bodyPaths) {
    assert.ok(!path.includes('.git/'), `body file must not live under .git/: ${path}`);
    assert.ok(
      path.startsWith('<PR_BODY_DIR>/'),
      `body file must sit in the allocated run directory, not an invented literal: ${path}`
    );
  }
  // Two-fence contract. The operation fence must contain NO allocator — it is
  // the one a reader is told to run verbatim, and an allocator in it strands a
  // directory on every re-run — and an allocation fence must precede it in
  // document order, so the substituted path has a documented provenance.
  let blocksChecked = 0;
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    const allocLines = allocationFences(content).map((node) => node.line);
    assert.ok(allocLines.length > 0, `${name}: the run directory needs an allocation fence`);
    for (const node of bashFences(content)) {
      if (!carriesBodyDir(node.text) || isTeardownFence(node.text) || isSanitizeFence(node.text)
      || isCaptureFence(node.text)) continue;
      const lines = shellLines(node.text);
      assert.ok(
        !lines.some((l) => /\bmktemp\b/.test(l)),
        `${name}: the operation fence must not allocate — a re-run would strand a second directory:\n${node.text}`
      );
      assert.ok(
        allocLines.some((l) => l < node.line),
        `${name}: an allocation fence must precede the operation fence at line ${node.line}`
      );
      blocksChecked += 1;
    }
  }
  assert.ok(blocksChecked >= 4, `expected every body-bearing block to be checked, got ${blocksChecked}`);
  assert.match(skillContent, /allowed-tools:.*\bWrite\b/, 'Write must be pre-approved');
  assert.match(skillContent, /allowed-tools:.*Bash\(mktemp:\*\)/, 'mktemp must be pre-approved');
  assert.match(skillContent, /allowed-tools:.*Bash\(rm:\*\)/, 'rm must be pre-approved for cleanup');
  assert.match(skillContent, /pre-edit-guard\.sh` rejects every `\.git\/` path/, 'the .git reason should be recorded');
  assert.match(skillContent, /atomic, returns a unique name, and creates it `0700`/, 'why mktemp -d should be recorded');
  assert.match(
    skillContent,
    /Each Bash invocation is a fresh shell/,
    'the literal-substitution rule should state why a shell variable does not work'
  );
});

test('cleanup runs last but never masks the operation status', () => {
  // Three properties, each with a way to fail. An unconditional trailing `rm`
  // succeeds, so the block would exit 0 after a failed gh. A bare command plus a
  // following capture line is skipped outright under a caller's `set -e`, leaking
  // the run directory. And a *named* status variable is the caller's: `readonly
  // STATUS=9` makes the assignment itself fail — after allocation — while an
  // ordinary caller silently loses its own value. Hence subshell + `$1`.
  // Cleanup is guarded too, and that is the fourth property. An unguarded `rm`
  // masks the operation twice over: it reports 0 after a failed `gh` when it
  // succeeds, and it REPLACES the operation's status when it fails — `gh` 37
  // then `rm` 5 reports 5 in bash, sh, zsh and dash alike. The arithmetic
  // re-raise gives the operation precedence and still surfaces a cleanup
  // failure when the operation succeeded, so a leaked body is never silent.
  const CLEANUP = /^rm -rf -- '<PR_BODY_DIR>(\/pr-body-\d+\.md)?' \|\| set -- "\$1" "\$\?"$/;
  const RERAISE = 'exit "$(( $1 ? $1 : ${2:-0} ))"';
  let checked = 0;
  for (const block of bodyBearingBlocks(bothContents)) {
    const lines = shellLines(block);
    assert.equal(lines.at(-1), ')', `block must close its subshell:\n${block}`);
    assert.equal(lines.at(-2), RERAISE, `block must re-raise with operation precedence:\n${block}`);
    assert.match(lines.at(-3), CLEANUP, `cleanup must itself be guarded:\n${block}`);
    const capture = lines.at(-4);
    assert.ok(
      capture && capture.endsWith('|| set -- "$?"'),
      `the fallible command must capture its status via a quoted \`|| set -- "$?"\`:\n${block}`
    );
    const openIdx = lines.indexOf('(');
    assert.ok(openIdx !== -1, `the operation must run in a subshell:\n${block}`);
    assert.equal(
      lines[openIdx + 1],
      'set -- 0',
      `the subshell must seed the status so the success path exits 0:\n${block}`
    );
    assert.ok(openIdx < lines.length - 4, `the subshell must open before the operation:\n${block}`);
    // No caller-visible variable anywhere in the block — that is the whole point.
    for (const line of lines) {
      assert.ok(
        !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line),
        `status must live in the subshell's positional parameters, not a caller variable: ${line}`
      );
    }
    checked += 1;
  }
  assert.ok(checked >= 4, `expected several body-bearing blocks, checked ${checked}`);
  // The shape is only half the contract; the reasons keep a future editor from
  // "simplifying" it back into the three defects it was built out of.
  for (const [pattern, reason] of [
    [/it must never \*\*mask\*\* the failure/, 'masking the failure'],
    [/errexit/, 'a caller\'s errexit skipping cleanup'],
    [/readonly STATUS/, 'a caller-owned status variable'],
    [/`IFS`/, 'field splitting on the caller\'s IFS'],
  ]) {
    assert.match(skillContent, pattern, `the rationale for ${reason} should be recorded`);
  }
});

test('each stacked layer writes its own body file within one run directory', () => {
  const chain = bodyBearingBlocks(stackContent).find((block) => block.includes('&&'));
  assert.ok(chain, 'the dry-run worked example should still be an &&-chained block');
  const layerPaths = shellLines(chain)
    .flatMap((line) => line.match(/--body-file '[^']+'/g) || [])
    .map((m) => m.replace(/--body-file '/, '').replace(/'$/, ''));
  assert.equal(layerPaths.length, 3, 'the worked example should name one body file per layer');
  assert.equal(new Set(layerPaths).size, 3, 'layers must not share a body file — execute mode re-renders them');
  const runDirs = new Set(layerPaths.map((p) => p.slice(0, p.lastIndexOf('/'))));
  assert.deepEqual([...runDirs], ['<PR_BODY_DIR>'], 'all layers of one run share the allocated directory');
});

test('the emitted stacked block stops at the failing layer, cleans up, and reports failure', () => {
  // Executes the SHIPPED block with `gh` stubbed out — the only way to prove the
  // status is not masked by the trailing rm. Nothing touches the real repo:
  // <PR_BODY_DIR> is substituted with a directory this test created.
  const sandbox = mkdtempSync(join(tmpdir(), 'create-pr-test-'));
  try {
    const runDir = join(sandbox, 'run');
    const binDir = join(sandbox, 'bin');
    const callLog = join(sandbox, 'calls.log');
    mkdirSync(runDir);
    mkdirSync(binDir);

    // Stub gh: log every invocation, fail on the second layer only.
    const ghStub = [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> ${JSON.stringify(callLog)}`,
      'case "$*" in *feat/auth-service*) exit 1 ;; esac',
      'exit 0',
    ].join('\n');
    writeFileSync(join(binDir, 'gh'), ghStub);
    chmodSync(join(binDir, 'gh'), 0o755);

    const block = bodyBearingBlocks(stackContent)[0];
    // Blocks already come without their fence markers.
    const script = block
      .replace(/^mktemp -d$/m, ':')          // the directory already exists here
      .replaceAll('<PR_BODY_DIR>', runDir);

    const result = spawnSync('bash', ['-c', script], {
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      encoding: 'utf8',
    });

    const calls = existsSync(callLog) ? readFileSync(callLog, 'utf8') : '';
    assert.ok(calls.includes('feat/auth-schema'), 'layer 1 should run');
    assert.ok(calls.includes('feat/auth-service'), 'layer 2 should be attempted');
    assert.ok(!calls.includes('feat/auth-api'), 'layer 3 must not run after layer 2 fails');
    assert.equal(existsSync(runDir), false, 'cleanup must still run on the failure path');
    assert.notEqual(result.status, 0, 'the failed layer must not be reported as success');
    assert.equal(result.status, 1, `block should surface the failing status, got ${result.status}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

// Runs a SHIPPED block with `gh` stubbed on PATH. `failPattern` is a shell
// `case` glob: any gh invocation matching it exits 1. `bashFlags` lets a caller
// impose `errexit`, which is how a real user's script or `set -e` wrapper runs it.
function runShippedBlock(block, { failPattern, bashFlags = [], prelude = '', shell = 'bash', exitCode = 1, rmExit = null, writeBodies = true }) {
  const sandbox = mkdtempSync(join(tmpdir(), 'create-pr-test-'));
  const runDir = join(sandbox, 'run');
  const binDir = join(sandbox, 'bin');
  const callLog = join(sandbox, 'calls.log');
  mkdirSync(runDir);
  mkdirSync(binDir);

  // The stub REQUIRES every --body-file it is handed to exist. Without this the
  // runtime tests proved nothing about the out-of-band write: `gh` accepted a
  // path that was never created, so a block naming an un-substituted placeholder
  // passed exactly like a correct one.
  const ghStub = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(callLog)}`,
    'want=0',
    'for arg in "$@"; do',
    '  if [ "$want" = 1 ]; then',
    '    [ -f "$arg" ] || { echo "missing body file: $arg" >&2; exit 66; }',
    '    want=0',
    '  fi',
    '  [ "$arg" = --body-file ] && want=1',
    'done',
    `case "$*" in ${failPattern}) exit ${exitCode} ;; esac`,
    'exit 0',
  ].join('\n');
  writeFileSync(join(binDir, 'gh'), ghStub);
  chmodSync(join(binDir, 'gh'), 0o755);

  if (rmExit !== null) {
    // A cleanup that fails, to prove it cannot replace the operation's status.
    writeFileSync(join(binDir, 'rm'), `#!/bin/sh\nexit ${rmExit}\n`);
    chmodSync(join(binDir, 'rm'), 0o755);
  }

  // Step 2 of the contract, performed for real: every body file the block names
  // is written out of band before the guarded operation runs.
  if (writeBodies) {
    for (const match of block.matchAll(/--body-file '<PR_BODY_DIR>\/([^']+)'/g)) {
      writeFileSync(join(runDir, match[1]), 'body\n');
    }
  }

  const script = prelude + block
    .replace(/^mktemp -d$/m, ':')
    .replaceAll('<PR_BODY_DIR>', runDir);

  const result = spawnSync(shell, [...bashFlags, '-c', script], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    encoding: 'utf8',
  });

  return {
    status: result.status,
    calls: existsSync(callLog) ? readFileSync(callLog, 'utf8') : '',
    runDirExists: existsSync(runDir),
    cleanup: () => rmSync(sandbox, { recursive: true, force: true }),
  };
}

test('under `set -e`, a failing final stacked layer still cleans up and reports failure', () => {
  // errexit is the case a bare `STATUS=$?` misses: layers 1-2 are non-fatal only
  // because `&&` makes them conditional, but the last command in the list is not.
  const run = runShippedBlock(bodyBearingBlocks(stackContent)[0], {
    failPattern: '*pr-body-3.md*',
    bashFlags: ['-e'],
  });
  try {
    assert.ok(run.calls.includes('feat/auth-schema'), 'layer 1 should run');
    assert.ok(run.calls.includes('feat/auth-service'), 'layer 2 should run');
    assert.ok(run.calls.includes('pr-body-3.md'), 'layer 3 should be attempted');
    assert.equal(run.runDirExists, false, 'errexit must not skip cleanup of the private PR body');
    assert.equal(run.status, 1, `the failing final layer must surface, got ${run.status}`);
  } finally {
    run.cleanup();
  }
});

test('under `set -e`, a failing single-PR block still cleans up and reports failure', () => {
  // The non-stack blocks have no `&&` list at all — one simple command, which is
  // precisely what errexit terminates on before any capture line is reached.
  const singleBlocks = bodyBearingBlocks(skillContent);
  assert.ok(singleBlocks.length >= 3, `expected the SKILL.md body-bearing blocks, got ${singleBlocks.length}`);
  for (const block of singleBlocks) {
    // Only the body-file command fails: a block may also show an illustrative
    // command that predates the allocation, and failing that one would prove nothing.
    const run = runShippedBlock(block, { failPattern: '*--body-file*', bashFlags: ['-e'] });
    try {
      assert.ok(run.calls.includes('--body-file'), `the gh command should have been attempted:\n${block}`);
      assert.equal(run.runDirExists, false, `errexit must not skip cleanup:\n${block}`);
      assert.equal(run.status, 1, `the failure must surface, got ${run.status}:\n${block}`);
    } finally {
      run.cleanup();
    }
  }
});

test('the runtime harness fails when the out-of-band body write did not happen', () => {
  // Pins the stub's body-file check. Without it the runtime tests proved
  // nothing about step 2: `gh` accepted a path that was never created, so a
  // block naming an un-substituted `<PR_BODY_DIR>/…` passed like a correct one.
  const block = bodyBearingBlocks(skillContent)[0];
  const run = runShippedBlock(block, {
    failPattern: '*nothing-matches-this*',
    writeBodies: false,
    bashFlags: ['-e'],
  });
  try {
    assert.equal(
      run.status,
      66,
      `a missing body file must surface as a failure, got ${run.status}`
    );
    assert.equal(run.runDirExists, false, 'cleanup still runs when the operation fails');
  } finally {
    run.cleanup();
  }
});

test('a failing cleanup cannot replace the operation status', () => {
  // The half the old "never masks" test missed: it covered a cleanup that
  // SUCCEEDS after a failed operation, and left the reverse untested. With an
  // unguarded `rm`, a `gh` exiting 37 followed by an `rm` exiting 5 reports 5 —
  // in bash, sh, zsh and dash alike — so the caller sees the wrong failure.
  for (const shell of shellNames()) {
    const block = bodyBearingBlocks(skillContent)[0];

    const opFailed = runShippedBlock(block, {
      failPattern: '*--body-file*',
      exitCode: 37,
      rmExit: 5,
      shell,
      bashFlags: ['-e'],
    });
    try {
      assert.equal(
        opFailed.status,
        37,
        `${shell}: the operation's status must win over a failing cleanup, got ${opFailed.status}`
      );
    } finally {
      opFailed.cleanup();
    }

    // And a cleanup failure must not be silent when the operation succeeded —
    // a leaked run directory holds a private PR body.
    const opOk = runShippedBlock(block, {
      failPattern: '*nothing-matches-this*',
      rmExit: 5,
      shell,
      bashFlags: ['-e'],
    });
    try {
      assert.equal(
        opOk.status,
        5,
        `${shell}: a failing cleanup must surface when the operation succeeded, got ${opOk.status}`
      );
    } finally {
      opOk.cleanup();
    }
  }
});

test('the skill is permitted to run the sanitizer it depends on', () => {
  // Step 4b invokes a script. Without `Bash(bash:*)` in allowed-tools the
  // security step is simply blocked at runtime, while every test that calls the
  // script directly still passes.
  const frontmatter = skillContent.slice(0, skillContent.indexOf('---', 3));
  assert.match(frontmatter, /Bash\(bash:\*\)/, 'allowed-tools must permit the sanitizer invocation');
  for (const tool of ['Bash(mktemp:*)', 'Bash(rm:*)', 'Bash(gh:*)', 'Write']) {
    assert.ok(frontmatter.includes(tool), `allowed-tools must still permit ${tool}`);
  }
});

test('dry-run runs no mutating gh command and leaves nothing on disk, in both documents', () => {
  // Dry-run is the DEFAULT mode, so what it leaves behind happens on every
  // preview. The property is durability, not inactivity: it must sanitize
  // (§ 4b operates on files, and the previewed body is what a user copies into
  // a real gh invocation), and it must tear its directory down itself rather
  // than leave cleanup inside a command the user may never run.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    assert.match(
      content,
      /runs no mutating `gh` command and leaves nothing on disk|runs no mutating `gh` call \(`gh pr create` \/ `gh pr edit`\) and leaves nothing on disk/,
      `${name}: dry-run must state both halves — no MUTATING gh call, and nothing left behind`
    );
    assert.match(
      content,
      /teardown fence/,
      `${name}: dry-run must name the teardown that makes "nothing left behind" true`
    );
  }
  // Both documents must also say which read-only calls dry-run does make. The
  // unqualified "no gh command" was false: Phase B routes on `gh pr list` and
  // Phase D chooses its output from `gh extension list`, so a reader following
  // the stricter reading would have to skip the steps that produce the report.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    assert.match(content, /gh pr list/, `${name}: name the read-only query dry-run still runs`);
    assert.match(content, /gh extension list/, `${name}: name the detection query dry-run still runs`);
  }
  // Asserting the corrected sentence EXISTS does not reject the obsolete one:
  // both survived side by side in this file's history, and the unqualified
  // form is the enforceable claim a reader acts on. So it is banned outright —
  // any "no `gh`" that is not narrowed to the mutating calls fails here.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    assert.doesNotMatch(
      content,
      /(?:runs?|executes?|makes?) no `gh`(?! (?:pr )?(?:create|edit))/,
      `${name}: "no \`gh\` command" is false — narrow it to the mutating calls`
    );
  }
  // The trap this replaced: "allocates nothing" reads stricter, but it makes
  // Step 4b unreachable in the default mode, since there is no file to sanitize.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    assert.doesNotMatch(
      content,
      /dry-run [^.]*allocat(?:es|ed) nothing/,
      `${name}: dry-run must not claim it allocates nothing — Step 4b needs a file to sanitize`
    );
  }
  assert.match(
    stackContent,
    /under `--execute` the skill performs all three itself/,
    'execute mode must be named as the mode that also performs the operation'
  );
});

test('every allocation fence is followed by the out-of-band write before any operation', () => {
  // The split into two fences is what makes the block executable at all, but it
  // also creates a gap: between allocating the directory and running `gh`, the
  // body file has to be written by something that is not shell. A split that
  // omits that instruction reads as complete and hands `--body-file` a path
  // that does not exist.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    const nodes = markdownNodes(content);
    const isAlloc = (n) => n.kind === 'fence' && SHELL_LANGS.has(fenceLang(n))
      && shellLines(n.text).length === 1 && shellLines(n.text)[0] === 'mktemp -d';
    const isCapture = (n) => n.kind === 'fence' && SHELL_LANGS.has(fenceLang(n)) && isCaptureFence(n.text);
    // A sanitize fence is not the operation this gap protects: it reads a file
    // that must already exist, so stopping the walk there would let an
    // allocation reach it with nothing having created the file.
    const isOperation = (n) => n.kind === 'fence' && SHELL_LANGS.has(fenceLang(n))
      && carriesBodyDir(n.text) && !isTeardownFence(n.text) && !isCaptureFence(n.text)
      && !isSanitizeFence(n.text);

    for (const [idx, node] of nodes.entries()) {
      if (!isAlloc(node)) continue;
      const between = [];
      let reachedOperation = false;
      let filledByCapture = false;
      for (const next of nodes.slice(idx + 1)) {
        // Step 7b's allocation is filled by its own capture fence — the
        // redirect creates the file, so there is no out-of-band write to
        // demand. That is a different discharge of the same obligation:
        // something between allocation and use must create the file.
        if (isCapture(next)) { filledByCapture = true; break; }
        if (isOperation(next)) { reachedOperation = true; break; }
        if (next.kind !== 'fence') between.push(next.text);
      }
      if (filledByCapture) continue;
      assert.ok(reachedOperation, `${name}:${node.line}: an allocation fence with no operation after it allocates for nothing`);
      const prose = between.join('\n');
      assert.match(
        prose,
        /out of band/i,
        `${name}:${node.line}: nothing between the allocation and the operation says the body is written out of band — as presented, --body-file names a file that was never created`
      );
      assert.match(
        prose,
        /Write tool/,
        `${name}:${node.line}: the out-of-band step must name the tool that performs it, or it reads as narration`
      );
    }
  }
});

const SANITIZER = resolve(__dirname, '../../skills/create-pr/scripts/sanitize-pr-content.sh');

/**
 * Step 4b as the skill actually performs it — through the boundary SKILL.md
 * renders, not by reaching past it.
 *
 * An earlier version sanitized with a helper written here, which proved only
 * that `gh` received the clean file the test had prepared. The version after
 * that ran the target script directly as `bash <script>`, which is a different
 * command from the documented one and could not observe anything the wrapper
 * layer does — caller-shadowed interpreter, unresolved wrapper symlink, the
 * `-p` handoff. Both defects lived exactly there. This runs the rendered form:
 * `/bin/bash -p scripts/run-skill.sh create-pr sanitize-pr-content.sh …`.
 */
const RUNNER = resolve(__dirname, '../../scripts/run-skill.sh');
function runSanitizer(mode, file) {
  const r = spawnSync(
    '/bin/bash',
    ['-p', RUNNER, 'create-pr', 'sanitize-pr-content.sh', mode, file],
    { encoding: 'utf8', cwd: resolve(__dirname, '../..') }
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('the sanitizer harness invokes the same command SKILL.md renders', () => {
  // Keeps the helper above honest: if the documented form changes and the
  // harness does not, the harness silently stops testing the shipped path.
  const rendered = /^(\S+) (-p) (\S*run-skill\.sh) (create-pr) (sanitize-pr-content\.sh)/;
  const documented = skillContent
    .split('\n')
    .find((l) => l.includes('run-skill.sh create-pr sanitize-pr-content.sh'));
  assert.ok(documented, 'SKILL.md must ship a sanitizer invocation');
  const m = rendered.exec(documented.trim());
  assert.ok(m, `the documented invocation must keep its shape, got: ${documented}`);
  assert.equal(m[1], '/bin/bash',
    'the documented interpreter must be absolute — a bare `bash` is resolved in the caller\'s shell');
  assert.equal(m[2], '-p', 'and privileged');
});

test('stacked execute sanitizes every layer through the shipped script, and the bytes gh received pass the shipped scanner', () => {
  // AC5 is a security criterion, so prose assertions do not discharge it
  // (Anchor Register #3). Hostile bodies are written UNSANITIZED, the shipped
  // sanitizer is run on each layer's own file, and the stub records what `gh`
  // was actually handed.
  const template = bodyBearingBlocks(stackContent)
    .find((b) => b.includes('pr-body-1.md') && !b.includes('&&') && !b.includes('pr-body-2.md'));
  assert.ok(template, 'stack-mode.md should ship a per-layer execute block');

  const LAYERS = [
    {
      branch: 'feat/auth-schema',
      title: 'feat: [PROJ-42] Add auth schema',
      body: '## Summary\n\nAdds the schema.\nCo-Authored-By: Claude <noreply@anthropic.com>\n',
      keep: /Adds the schema\./,
    },
    {
      branch: 'feat/auth-service',
      title: 'feat: [PROJ-42] Add auth service',
      body: '## Summary\n\nStacked on #116\n🤖 Generated with Claude Code\nAdds the service.\n',
      keep: /Stacked on #116/,
    },
    {
      branch: 'feat/auth-api',
      title: 'feat: [PROJ-42] Add auth api',
      body: '## Summary\n\nStacked on #117\nAdds the endpoint.\nGenerated by GPT-4\n',
      keep: /Stacked on #117/,
    },
  ];

  const fx = ghRecorderFixture();
  try {
    LAYERS.forEach((layer, i) => {
      const n = i + 1;
      const file = join(fx.runDir, `pr-body-${n}.md`);
      // Written hostile, exactly as generation would have produced it.
      writeFileSync(file, layer.body);

      // One title file per layer, as references/stack-mode.md § Per-layer
      // commands requires — a shared name would leave the LAST layer's title
      // behind rather than the failing layer's.
      const title = writeTemp(fx.runDir, `pr-title-${n}.txt`, layer.title);
      assert.equal(runSanitizer('title', title).status, 0, `layer ${n} title should be clean`);

      // `body-inplace`, the mode SKILL.md Step 4b documents — not `body` with
      // the test writing stdout back. Supplying that write here would be the
      // test implementing the workflow step it is supposed to be checking, and
      // it would pass just as well if the shipped path had no way to persist
      // the sanitized bytes at all.
      const sanitized = runSanitizer('body-inplace', file);
      assert.equal(sanitized.status, 0, `layer ${n} body sanitization failed: ${sanitized.stderr}`);
      assert.match(sanitized.stderr, /\[AI_STRIPPED\]/, `layer ${n} must actually have had something stripped`);

      const r = spawnSync('/bin/sh', ['-e', '-c', renderLayer(template, layer, file, title)], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fx.binDir}:${process.env.PATH}` },
      });
      assert.equal(r.status, 0, `layer ${n} block failed: ${r.stderr}`);
      assert.equal(existsSync(file), false, `layer ${n} must remove its own body file once published`);
      // The verdict must belong to the bytes that were published. `title` mode
      // scanned this file; the call has to carry exactly what it scanned.
      assert.ok(
        fx.calls()[n - 1].includes(readFileSync(title, 'utf8').replace(/\n$/, '')),
        `layer ${n} must publish the title bytes that passed the scan`
      );
    });

    const published = [1, 2, 3].map((n) => readFileSync(join(fx.received, `body-${n}.md`), 'utf8'));
    published.forEach((text, i) => {
      // Ask the SHIPPED scanner whether the received bytes are clean. A JS `RegExp`
      // built from the shell ERE is a re-implementation: it is not `LC_ALL=C grep -Ei`
      // and its verdict can differ on locale, byte handling and word boundaries — so
      // it could pass content the real policy rejects, or the reverse.
      const receivedPath = join(fx.received, `body-${i + 1}.md`);
      const verdict = runSanitizer('scan', receivedPath);
      assert.equal(verdict.status, 0,
        `layer ${i + 1} published content is not clean per the shipped scanner: ${verdict.stderr}`);
      assert.match(text, /## Summary/, `layer ${i + 1} must keep its template structure`);
      assert.match(text, LAYERS[i].keep, `layer ${i + 1} must keep its innocent content`);
    });
    assert.notEqual(published[0], published[1], 'each layer publishes its own content, not a shared file');
    assert.deepEqual(
      readdirSync(fx.runDir).filter((f) => f.startsWith('pr-body-')),
      [],
      'no body file may outlive the layer that published it'
    );
    // Title snapshots are not per-layer cleanup artifacts; the run directory's
    // own teardown fence is what removes whatever is left.
    assert.deepEqual(readdirSync(fx.runDir).sort(), ['pr-title-1.txt', 'pr-title-2.txt', 'pr-title-3.txt'],
      'only the per-layer title snapshots may remain');
  } finally {
    fx.cleanup();
  }
});

function writeTemp(dir, name, content) {
  const file = join(dir, name);
  writeFileSync(file, `${content}\n`);
  return file;
}

/**
 * The published `--title` is rendered from the BYTES OF THE SCANNED FILE, never
 * from the title the generator held. `gh` has no `--title-file`, so the title is
 * the one field where the checked artifact and the published one could diverge:
 * scan `pr-title-N.txt`, then publish a stale or separately-rendered string, and
 * the verdict belongs to bytes that were never sent. Reading it back here is
 * what makes this harness able to notice that — taking `layer.title` would make
 * the two identical by construction and prove nothing.
 */
function renderLayer(template, layer, bodyPath, titlePath) {
  const title = readFileSync(titlePath, 'utf8').replace(/\n$/, '');
  return shellLines(template)
    .join('\n')
    .replace("'feat/auth-schema'", shellRender(layer.branch))
    .replace(/--title '[^']*'/, `--title ${shellRender(title)}`)
    .replace(/'<PR_BODY_DIR>\/pr-body-1\.md'/g, shellRender(bodyPath));
}

/** A sandbox whose `gh` records the bytes it was handed, and every call made. */
function ghRecorderFixture() {
  const sandbox = mkdtempSync(join(tmpdir(), 'create-pr-stack-'));
  const runDir = join(sandbox, 'run');
  const binDir = join(sandbox, 'bin');
  const received = join(sandbox, 'received');
  mkdirSync(runDir);
  mkdirSync(binDir);
  mkdirSync(received);
  writeFileSync(join(binDir, 'gh'), [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(join(received, 'calls.log'))}`,
    // `gh pr view` serves whatever the test declared as published, so the
    // shipped Step 7b fence — including its redirect — can actually run.
    'if [ "$1" = pr ] && [ "$2" = view ]; then',
    `  cat ${JSON.stringify(join(received, 'view.txt'))}`,
    '  exit $?',
    'fi',
    'want=0',
    'for arg in "$@"; do',
    '  if [ "$want" = 1 ]; then',
    '    [ -f "$arg" ] || { echo "missing body file: $arg" >&2; exit 66; }',
    `    n=$(cat ${JSON.stringify(join(received, 'seq'))} 2>/dev/null || echo 0); n=$((n+1))`,
    `    printf '%s' "$n" > ${JSON.stringify(join(received, 'seq'))}`,
    `    cp "$arg" ${JSON.stringify(received)}/body-$n.md`,
    // GitHub serves what was last published: an edit changes what `pr view`
    // returns. Without this the second verification would scan the pre-edit
    // snapshot and report clean no matter what the remediation actually sent.
    `    v=${JSON.stringify(join(received, 'view.txt'))}`,
    '    { [ -f "$v" ] && head -n 1 "$v"; cat "$arg"; } > "$v.tmp"',
    '    mv "$v.tmp" "$v"',
    '    want=0',
    '  fi',
    '  [ "$arg" = --body-file ] && want=1',
    'done',
    'exit 0',
  ].join('\n'));
  chmodSync(join(binDir, 'gh'), 0o755);
  return {
    runDir,
    binDir,
    received,
    /** Declare what `gh pr view` will return for this PR. */
    publish: (text) => writeFileSync(join(received, 'view.txt'), text),
    calls: () => (existsSync(join(received, 'calls.log'))
      ? readFileSync(join(received, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean)
      : []),
    cleanup: () => rmSync(sandbox, { recursive: true, force: true }),
  };
}

test('Step 4b persists the sanitized body through the script, not a shell redirect', () => {
  // `sanitizer body <file> > <file>` truncates the file before the sanitizer
  // reads it, so the published body would be empty — the failure is silent and
  // looks like a body that was simply stripped to nothing. Step 4b therefore
  // documents `body-inplace`, which replaces the file itself via a sibling
  // temp file and an atomic rename.
  const step4b = extractSection(skillContent, '### 4b');
  assert.match(
    step4b,
    /sanitize-pr-content\.sh body-inplace '<PR_BODY_DIR>\/pr-body-1\.md'/,
    'Step 4b must invoke body-inplace — stdout mode leaves nothing persisting the result'
  );
  // The hazard itself must never appear as a copyable instruction anywhere.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    assert.doesNotMatch(
      content,
      /sanitize-pr-content\.sh body '[^']+'\s*>/,
      `${name}: redirecting body mode over a file truncates it before it is read`
    );
  }
  // And the runtime proof that the mode name in the document is the one that
  // actually persists: stdout mode must leave the file untouched.
  const dir = mkdtempSync(join(tmpdir(), 'create-pr-4b-'));
  try {
    const file = join(dir, 'pr-body-1.md');
    const hostile = '## Summary\n\nReal content.\nCo-Authored-By: Claude <noreply@anthropic.com>\n';
    writeFileSync(file, hostile);
    runSanitizer('body', file);
    assert.equal(readFileSync(file, 'utf8'), hostile, 'stdout mode must not be mistaken for persistence');
    runSanitizer('body-inplace', file);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /Co-Authored-By/, 'in-place mode is what persists the result');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a hostile title aborts Step 4b before gh is invoked at all', () => {
  // The other half of the security AC: bodies are stripped, titles are not.
  // "HARD FAIL" has to mean no PR is touched — asserting that the words appear
  // in the document proves nothing about that.
  const fx = ghRecorderFixture();
  try {
    const title = writeTemp(fx.runDir, 'pr-title.txt', 'feat: 🤖 Generated with Claude Code');
    const first = runSanitizer('title', title);
    assert.equal(first.status, 3, 'a hostile title must be rejected');

    // One regeneration attempt, per the documented policy — still hostile.
    writeFileSync(title, 'feat: Generated by GPT-4\n');
    const second = runSanitizer('title', title);
    assert.equal(second.status, 3, 'a still-hostile regenerated title must fail again');

    // HARD FAIL: nothing ran. The recorder proves it rather than the prose.
    assert.deepEqual(fx.calls(), [], 'no gh command may run after a hard-failed title');
    assert.deepEqual(readdirSync(fx.received), [], 'nothing may have been published');

    // Positive control, and it is what makes the two assertions above mean
    // anything. An empty recorder is also what a harness that never runs a
    // block produces, so on its own it cannot distinguish "the gate stopped
    // it" from "nothing was ever attempted". Same fixture, same shipped block,
    // a title that passes: the call must now be recorded.
    const body = join(fx.runDir, 'pr-body-1.md');
    writeFileSync(body, '## Summary\n\nAdds the widget.\n');
    writeFileSync(title, 'feat: [PROJ-42] Add widget endpoint\n');
    assert.equal(runSanitizer('title', title).status, 0, 'the control title must pass');
    const block = bodyBearingBlocks(skillContent).find((b) => b.includes('gh pr create'));
    assert.ok(block, 'SKILL.md should ship a create block');
    const r = spawnSync('/bin/sh', ['-e', '-c',
      renderLayer(block, { branch: 'feat/widget', title: 'unused' }, body, title)], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fx.binDir}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, `the control block should succeed: ${r.stderr}`);
    assert.equal(fx.calls().length, 1, 'the recorder does observe a gh call when one is made');

    const step4b = extractSection(skillContent, '### 4b');
    assert.match(step4b, /HARD FAIL/, 'the documented remedy is abort, not strip');
    assert.match(step4b, /No `gh` command runs/, 'the document must state that nothing is executed');
  } finally {
    fx.cleanup();
  }
});

test('Step 7b detects a published leak, remediates it, and re-verifies clean', () => {
  // The full post-creation cycle, executed: fetch published content, scan it,
  // and — only if it leaked — re-publish a sanitized body and scan again.
  const fx = ghRecorderFixture();
  try {
    // The PR as GitHub actually holds it: its published body carries a trailer.
    fx.publish('feat: [PROJ-42] Add widget\n## Summary\n\nAdds it.\nCo-Authored-By: Claude <noreply@anthropic.com>\n');

    // The verification cycle as shipped — V1's directory, V2's fence including
    // its redirect, V3's scan. Fabricating published.txt here instead would let
    // the test pass even if no documented step ever created the file the very
    // next command scans, and re-implementing the cycle for the second run
    // would let the shipped Step 4 degrade without any test noticing.
    // All four steps come out of the document. Substituting a Node equivalent
    // for any of them — mkdtempSync for V1, a helper for V3, rmSync for V4 —
    // would leave that step free to disappear from the shipped cycle without a
    // test noticing, which is the defect this whole section keeps re-earning.
    const fences = bashFences(skillContent).map((n) => n.text);
    const allocFence = fences.find((t) => shellLines(t).join('\n') === 'mktemp -d');
    const captureFence = fences.find(isCaptureFence);
    const scanFence = fences.find((t) => {
      const [line, ...rest] = shellLines(t);
      return rest.length === 0 && SANITIZE_FORM.test(line) && line.includes(' scan ');
    });
    const teardownFence = fences.filter(isTeardownFence)[0];
    for (const [step, fence] of [['V1', allocFence], ['V2', captureFence], ['V3', scanFence], ['V4', teardownFence]]) {
      assert.ok(fence, `SKILL.md should ship a fence for ${step} of the verification cycle`);
    }
    // Step 4 must say the cycle runs a second time; without that the loop below
    // would be the test's own idea of the workflow rather than the document's.
    const step7b = extractSection(skillContent, '### 7b');
    assert.match(step7b, /Step 4 — run the verification cycle again/,
      'the document must run the cycle a second time after remediation');

    const sh = (script, extraEnv) => spawnSync('/bin/sh', ['-c', script], {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, PATH: `${fx.binDir}:${process.env.PATH}`, ...extraEnv },
    });
    const runCycle = (label) => {
      const alloc = sh(shellLines(allocFence).join('\n'));            // V1
      assert.equal(alloc.status, 0, `${label}: the allocation fence failed: ${alloc.stderr}`);
      const dir = alloc.stdout.trim();
      assert.ok(dir && existsSync(dir), `${label}: V1 must print a directory that exists`);

      const render = (fence) => shellLines(fence).join('\n').replace(/'<PR_BODY_DIR>/g, `'${dir}`);
      const captured = sh(`set -e\n${render(captureFence)}`);         // V2
      assert.equal(captured.status, 0, `${label}: the capture fence failed: ${captured.stderr}`);
      const file = join(dir, 'published.txt');
      assert.ok(existsSync(file), `${label}: the shipped fence itself must create the file the scan reads`);
      const seen = readFileSync(file, 'utf8');

      const scan = sh(render(scanFence));                             // V3
      const teardown = sh(render(teardownFence)                       // V4
        .replace('<PRIOR_STATUS>', String(scan.status)));
      assert.equal(teardown.status, scan.status,
        `${label}: teardown must carry the scan's verdict, not its own success`);
      assert.ok(!existsSync(dir), `${label}: the captured snapshot must not outlive the check`);
      return { scan, seen };
    };

    const first = runCycle('first verification');
    assert.equal(first.scan.status, 4, 'a published leak must be detected');
    assert.match(first.scan.stderr, /\[AI_DETECTED\]/, 'the leaking line must be located');

    // Remediation 3a/3b: a fresh directory holding the Step 4b snapshot — the
    // body the skill sanitized before publishing, not the leaked capture. Step
    // 3's guardrail 2 is exactly this: do not re-derive the remedy from what
    // leaked.
    const remedyDir = mkdtempSync(join(fx.runDir, 'remedy-'));
    const remediation = join(remedyDir, 'pr-body-1.md');
    writeFileSync(remediation, '## Summary\n\nAdds it.\n');
    assert.equal(runSanitizer('scan', remediation).status, 0, 'the Step 4b snapshot is clean by construction');

    // Scoped to Step 7b: the generic Step 5a edit block is a different command
    // with a different purpose, and picking it up here would let 3c vanish
    // while this test kept passing on its neighbour.
    const editBlock = bodyBearingBlocks(step7b).find((b) => b.includes('gh pr edit'));
    assert.ok(editBlock, 'Step 7b should ship its own guarded edit block for remediation (3c)');
    const script = shellLines(editBlock)
      .join('\n')
      .replace(/'<PR_BODY_DIR>\/pr-body-1\.md'/g, shellRender(remediation))
      .replace(/rm -rf -- '<PR_BODY_DIR>'/, `rm -rf -- ${shellRender(remediation)}`);
    const r = spawnSync('/bin/sh', ['-e', '-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fx.binDir}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, `remediation block failed: ${r.stderr}`);

    // Step 4 — the same cycle again, against what GitHub now holds. Reading
    // the recorder's copy of the sent body instead would verify the request
    // rather than the published state.
    const second = runCycle('second verification');
    assert.equal(second.scan.status, 0, 're-verification must find no leak');
    assert.match(second.seen, /Adds it\./, 'remediation must not discard the real content');
    assert.ok(fx.calls().some((c) => c.startsWith('pr edit')), 'remediation must go through gh pr edit');
  } finally {
    fx.cleanup();
  }
});

test('a failed capture still tears down the directory it already wrote into', () => {
  // The redirect opens published.txt *before* `gh` runs, so a failed capture is
  // not a no-op: the file exists, and for a private repository it can hold a
  // partial title and body. There is no verdict to reach at that point — V3
  // would scan a truncated snapshot — so the only correct move is V4 with
  // `gh`'s own status, which is what the shipped cycle now says.
  const cycle = extractSection(skillContent, '#### The verification cycle');
  assert.match(cycle, /Run \*\*V4\*\* immediately with `<PRIOR_STATUS>` = `gh`'s exit, then stop/,
    'the cycle table must route a failed capture to teardown, not to the scan');

  const fx = ghRecorderFixture();
  try {
    // No view.txt was ever declared, so the stub's `cat` fails — the same shape
    // as a `gh pr view` against a deleted PR or an expired token.
    const dir = mkdtempSync(join(fx.runDir, 'verify-'));
    const captureFence = bashFences(skillContent).map((n) => n.text).find(isCaptureFence);
    const capture = shellLines(captureFence).join('\n').replace(/'<PR_BODY_DIR>/g, `'${dir}`);
    const captured = spawnSync('/bin/sh', ['-c', capture], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fx.binDir}:${process.env.PATH}` },
    });
    assert.notEqual(captured.status, 0, 'the capture must report the failure it hit');
    assert.ok(existsSync(join(dir, 'published.txt')),
      'the redirect creates the file regardless — this is the leak V4 exists to remove');

    const teardown = bashFences(skillContent).map((n) => n.text).filter(isTeardownFence)[0];
    const script = shellLines(teardown)
      .join('\n')
      .replace('<PRIOR_STATUS>', String(captured.status))
      .replace("'<PR_BODY_DIR>'", shellRender(dir));
    const r = spawnSync('/bin/sh', ['-e', '-c', script], { encoding: 'utf8' });
    assert.equal(r.status, captured.status, "teardown must carry gh's status, not its own success");
    assert.ok(!existsSync(dir), 'the partial snapshot must not outlive the failed capture');
  } finally {
    fx.cleanup();
  }
});

test('the teardown fence removes the directory without ever masking a failed layer', () => {
  // P2-4's runtime half. A layer block that fails exits non-zero, so anything
  // chained after it under `set -e` would never run — teardown is dispatched as
  // its own fence for exactly that reason, and it must still report the layer's
  // status rather than its own success.
  const teardown = bashFences(bothContents).map((n) => n.text).filter(isTeardownFence);
  // Three sites, one shape: § Command Rendering (every exit before the guarded
  // operation), Step 7b's verification directory, and stack-mode's run
  // directory. They are byte-identical on purpose — a second shape is a second
  // thing to get wrong, and this equality is what lets one runtime check below
  // stand for all of them.
  assert.equal(teardown.length, 3, 'every teardown site ships the same fence');
  assert.equal(new Set(teardown.map((t) => shellLines(t).join('\n'))).size, 1,
    'the teardown fences must not have drifted apart');

  const runTeardown = (shell, prior, rmExit) => {
    const sandbox = mkdtempSync(join(tmpdir(), 'create-pr-teardown-'));
    const runDir = join(sandbox, 'run');
    const binDir = join(sandbox, 'bin');
    mkdirSync(runDir);
    mkdirSync(binDir);
    writeFileSync(join(runDir, 'pr-body-1.md'), 'private body\n');
    if (rmExit !== null) {
      // A cleanup that fails after doing nothing, so a leaked body is real.
      writeFileSync(join(binDir, 'rm'), `#!/bin/sh\nexit ${rmExit}\n`);
      chmodSync(join(binDir, 'rm'), 0o755);
    }
    const script = shellLines(teardown[0])
      .join('\n')
      .replace('<PRIOR_STATUS>', String(prior))
      .replace("'<PR_BODY_DIR>'", shellRender(runDir));
    const r = spawnSync(shell, ['-e', '-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    });
    const leaked = existsSync(runDir);
    rmSync(sandbox, { recursive: true, force: true });
    return { status: r.status, leaked };
  };

  for (const shell of shellNames()) {
    // A layer failed with 37; teardown succeeds and must still report 37.
    const afterFailure = runTeardown(shell, 37, null);
    assert.equal(afterFailure.status, 37, `${shell}: teardown must not mask the failing layer`);
    assert.equal(afterFailure.leaked, false, `${shell}: the run directory must be gone`);

    // Every layer succeeded and teardown itself failed — that must surface,
    // because the directory still holds private PR bodies.
    const cleanupFailed = runTeardown(shell, 0, 5);
    assert.equal(cleanupFailed.status, 5, `${shell}: a failed teardown must not report success`);
    assert.equal(cleanupFailed.leaked, true, `${shell}: the fixture must actually leak, or nothing was proved`);

    // Both failed: the layer's status wins, and the leak is still reported by
    // the directory's continued existence rather than by the exit code.
    const both = runTeardown(shell, 37, 5);
    assert.equal(both.status, 37, `${shell}: the operation's status has precedence`);
  }

  // The success path stays quiet.
  for (const shell of ['bash', 'sh']) {
    const clean = runTeardown(shell, 0, null);
    assert.equal(clean.status, 0, `${shell}: a clean run must exit 0`);
    assert.equal(clean.leaked, false, `${shell}: a clean run must remove the directory`);
  }
});

test('execute mode sequences per layer instead of chaining, because the number comes from GitHub', () => {
  // The defect this replaces: three `gh pr create` calls joined by `&&` in one
  // rendered list, while layer N+1's body must already contain layer N's PR
  // NUMBER. A chain offers no point at which control returns to write the next
  // body, so it can only publish stale branch markers.
  const phaseC = extractSection(stackContent, '## Phase C');
  assert.ok(phaseC, 'stack-mode.md should still have a Phase C section');

  // 1. The contract must say the chain shape is dry-run's, not execute's.
  assert.match(
    phaseC,
    /one guarded block per layer/,
    'execute mode must be stated as per-layer, not as one chain'
  );

  // 2. `gh pr create` prints a URL. Any claim that it "returns its number" is
  //    false, and it is what made the chain look workable.
  assert.ok(
    !/`gh pr create` \*returns\* its number/.test(phaseC),
    'gh pr create prints the PR URL, not its number'
  );
  assert.match(phaseC, /prints the PR \*URL\*, not its number/, 'the URL/number distinction must be stated');

  // 3. So the number is read back with an explicit, read-only command.
  const readBack = bashCommandLines(stackContent).find((l) => /^gh pr view .* --json number/.test(l));
  assert.ok(readBack, 'the reference must ship the command that reads the new PR number back');
  assert.ok(
    AUTHORIZED_READ_ONLY.has(readBack),
    `the read-back must be an exact authorized read-only form, not an ad hoc command:\n${readBack}`
  );
  assert.ok(!/--jq '\.[^']*\$/.test(readBack), 'the jq expression must be closed and quoted');
});

test('a per-layer execute block cleans only its own body file', () => {
  // Directory-wide cleanup inside a per-layer block would delete the bodies the
  // layers above it have not published yet. The directory goes at the end, in
  // its own teardown fence, on the success and failure paths alike.
  const perLayer = bodyBearingBlocks(stackContent).filter((b) => !b.includes('&&'));
  assert.ok(perLayer.length >= 1, 'the reference should ship a per-layer execute block');
  for (const block of perLayer) {
    const cleanup = shellLines(block).find((l) => l.startsWith('rm -rf'));
    assert.match(
      cleanup,
      /^rm -rf -- '<PR_BODY_DIR>\/pr-body-\d+\.md' \|\| set -- "\$1" "\$\?"$/,
      `a per-layer block must clean its own file, not the shared directory:\n${block}`
    );
  }
  const teardown = bashFences(stackContent).filter((n) => isTeardownFence(n.text));
  assert.equal(teardown.length, 1, 'exactly one teardown fence removes the run directory');
});

test('a caller that already owns a STATUS variable cannot break cleanup', () => {
  // The named-variable form fails here twice over: `readonly STATUS=9` makes the
  // seeding assignment itself fail — under `set -e` that aborts after `mktemp -d`
  // has run, leaking the private PR body — and on the success path the caller
  // silently loses its own value.
  const prelude = 'readonly STATUS=9\nset -e\n';
  for (const [label, block] of [
    ...bodyBearingBlocks(skillContent).map((b, i) => [`SKILL.md #${i}`, b]),
    ['stack-mode.md #0', bodyBearingBlocks(stackContent)[0]],
  ]) {
    for (const failPattern of ['*--body-file*', 'no-such-invocation']) {
      const run = runShippedBlock(block, { failPattern, bashFlags: ['-e'], prelude });
      const expected = failPattern === '*--body-file*' ? 1 : 0;
      try {
        assert.ok(run.calls.includes('--body-file'), `${label}: the gh command should have been attempted`);
        assert.equal(run.runDirExists, false, `${label}: a caller-owned STATUS must not block cleanup`);
        assert.equal(
          run.status,
          expected,
          `${label}: expected exit ${expected} with failPattern ${failPattern}, got ${run.status}`
        );
      } finally {
        run.cleanup();
      }
    }
  }
});

/** Shells present on this machine, among the ones the contract claims to hold for */
function availableShells() {
  return [
    { name: 'bash', bin: 'bash', flags: ['-e', '-u'] },
    { name: 'sh', bin: 'sh', flags: ['-e', '-u'] },
    // shwordsplit makes zsh split unquoted expansions the way bash does — the
    // option a user may well have on, and the one that turned a wrong status
    // into a reported success.
    { name: 'zsh', bin: 'zsh', flags: ['-o', 'shwordsplit', '-e', '-u'] },
    { name: 'dash', bin: 'dash', flags: ['-e', '-u'] },
    // `shell: true` with an args array is deprecated (DEP0190) — pass one string.
  ].filter(({ bin }) => spawnSync('/bin/sh', ['-c', `command -v ${bin}`]).status === 0);
}

/**
 * The shells to loop a POSIX contract over. Never a hard-coded list: `zsh` and
 * `dash` are optional on a CI runner, and an absent binary makes
 * `spawnSync().status` null, which fails the assertion for an environment reason
 * rather than a product one. `bash` and `sh` are required — a runner without
 * them cannot execute this project's scripts at all, so demanding them is a real
 * check rather than a portability hazard.
 */
function shellNames() {
  const names = availableShells().map((sh) => sh.name);
  for (const required of ['bash', 'sh']) {
    assert.ok(names.includes(required), `${required} must be available to run these contracts`);
  }
  return names;
}

test("a caller's IFS cannot swallow the captured status", () => {
  // `set -- $?` unquoted is field-split with the caller's IFS. With IFS=7 and a
  // gh exiting 7, the argument splits to nothing: bash and sh then re-raise the
  // wrong code and zsh under shwordsplit reports success — a failed PR create
  // read as a clean run. Quoting the expansion is the whole fix.
  const shells = availableShells();
  assert.ok(shells.length >= 1, 'at least bash should be available to run this contract');
  const blocks = [
    ...bodyBearingBlocks(skillContent).map((b, i) => [`SKILL.md #${i}`, b]),
    ['stack-mode.md #0', bodyBearingBlocks(stackContent)[0]],
  ];
  for (const { name, bin, flags } of shells) {
    for (const [label, block] of blocks) {
      const run = runShippedBlock(block, {
        failPattern: '*--body-file*',
        exitCode: 7,
        shell: bin,
        bashFlags: flags,
        prelude: 'IFS=7\n',
      });
      try {
        assert.equal(run.runDirExists, false, `${name} ${label}: cleanup must still run`);
        assert.equal(
          run.status,
          7,
          `${name} ${label}: the operation's own status must survive the caller's IFS, got ${run.status}`
        );
      } finally {
        run.cleanup();
      }
    }
  }
});


/**
 * Split a command line on *unquoted* control operators, keeping quoted text
 * intact — a title of `fix: A && B` is data, not a second command.
 */
function splitUnquoted(line) {
  const { chars, open } = scanShell(line);
  const segments = [];
  const operators = [];
  let current = '';
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    if (isOperative(c)) {
      const next = chars[i + 1];
      const pair = next && isOperative(next) ? c.ch + next.ch : '';
      if (pair === '&&' || pair === '||') {
        segments.push(current.trim());
        operators.push(pair);
        current = '';
        i += 1;
        continue;
      }
      if (c.ch === ';' || c.ch === '|' || c.ch === '&' || c.ch === '\n') {
        segments.push(current.trim());
        operators.push(c.ch);
        current = '';
        continue;
      }
    }
    current += c.raw;
  }
  assert.equal(open, false, `command must not end inside an open quote: ${line}`);
  segments.push(current.trim());
  return { segments, operators };
}

/**
 * Split a command word into its quoted / unquoted runs, so a check can ask about
 * the unquoted parts only. `--title 'a && b'` is one word whose quoted run is
 * data; `${EXTRA-}` is an unquoted run that the caller controls.
 */
function unquotedRuns(word) {
  const runs = [];
  let current = '';
  for (const c of scanShell(word).chars) {
    if (c.delimiter || c.quoted || c.escaped) {
      if (current) { runs.push(current); current = ''; }
      continue;
    }
    current += c.ch;
  }
  if (current) runs.push(current);
  return runs;
}

/**
 * An unquoted backslash — a character the shell removes and a naive scan keeps,
 * so `118\X` reads as PR 118 here and arrives at `gh` as `118X`.
 *
 * The one legitimate unquoted backslash is the POSIX single-quote escape
 * `'\''`, which is exactly what shellRender emits for a title like `O'Brien`.
 * Dropping that sequence before the scan keeps the quote state correct: it
 * always sits between two quoted runs, so the scanner is inside quotes on both
 * sides of it and deleting it merges them into one run. Replacing it with a
 * quote instead would flip the state and hide a real escape later in the word.
 */
function hasUnquotedBackslash(word) {
  // The ONLY legitimate unquoted escape is the apostrophe joining two quoted
  // runs — what shellRender emits for `O'Brien`. An escaped character anywhere
  // else is one the shell rewrites and a scan of the source text would not:
  // `118\X` reads as PR 118 here and arrives as `118X`, and `42\'` reads as 42
  // here and arrives as the branch selector `42'`.
  const { chars } = scanShell(word);
  return chars.some((c, i) => c.escaped && !isCanonicalJoin(chars, i));
}

/** Words of a command segment, splitting on unquoted whitespace only */
function commandWords(segment) {
  const words = [];
  let current = '';
  let started = false;
  for (const c of scanShell(segment).chars) {
    if (isOperative(c) && /\s/.test(c.ch)) {
      if (started) { words.push(current); current = ''; started = false; }
      continue;
    }
    current += c.raw;
    started = true;
  }
  if (started) words.push(current);
  return words;
}

/** `$(` or a backtick outside single quotes — a command word the reader cannot see */
function unquotedSubstitution(text) {
  const { chars } = scanShell(text);
  return chars.some((c, i) => {
    if (!isOperative(c)) return false;
    if (c.ch === '`') return true;
    const next = chars[i + 1];
    return c.ch === '$' && next && isOperative(next) && (next.ch === '(' || next.ch === '{');
  });
}

/** Replace a block's gh operation with a placeholder, leaving only the skeleton */
function skeleton(block) {
  return shellLines(block).map((line) => {
    if (line.startsWith('gh ')) return '<OPERATION>';
    // The operand varies by mode and the guard does not: single-PR and dry-run
    // blocks remove the directory, a stacked execute layer removes its own file.
    if (/^rm -rf -- '<PR_BODY_DIR>(\/pr-body-\d+\.md)?' \|\| set -- "\$1" "\$\?"$/.test(line)) {
      return '<CLEANUP>';
    }
    return line;
  });
}

test('every fence marker in both documents is an actual node boundary', () => {
  // Fail closed rather than chase CommonMark's container rules. "Somewhere inside
  // another node's span" is not enough: a `text` fence opened in a blockquote and
  // closed at top level swallows a real bash fence, and every line of the swallowed
  // fence then counts as accounted for. A marker must be a node's own opener or
  // closer — an unsupported or ambiguous form is a test failure telling the author
  // to move the fence to the supported top-level form.
  const container = /^(\s*(?:>\s?|[-*+]\s+|\d+[.)]\s+))+/;
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    const boundaries = new Set();
    for (const node of markdownNodes(content)) {
      if (node.kind !== 'fence') continue;
      boundaries.add(node.span[0]);
      boundaries.add(node.span[1]);
    }
    for (const [idx, line] of content.split('\n').entries()) {
      if (!/^\s*(`{3,}|~{3,})/.test(line.replace(container, ''))) continue;
      assert.ok(
        boundaries.has(idx + 1),
        `${name}:${idx + 1} is a fence marker that is not a node boundary — nest it with a longer marker or move it to a top-level fence so every extractor sees it:\n${line}`
      );
    }
  }
});

test('the cleanup shape is defined by exactly one canonical fenced block', () => {
  const LABEL = '**Canonical cleanup block.**';
  const labels = skillContent.split(LABEL).length - 1;
  assert.equal(labels, 1, `exactly one block may claim to be canonical, found ${labels}`);

  // Node adjacency, not character proximity: the node right after the label's
  // paragraph must BE the canonical fence. A distance heuristic lets an
  // intervening paragraph ("run gh pr close 42 first") sit between them, and
  // punishes a longer legitimate intro.
  const nodes = markdownNodes(skillContent);
  const labelIdx = nodes.findIndex((node) => node.kind === 'prose' && node.text.includes(LABEL));
  assert.notEqual(labelIdx, -1, 'the canonical label should live in a prose node');
  const next = nodes[labelIdx + 1];
  assert.ok(next, 'the canonical label must be followed by something');
  assert.equal(next.kind, 'fence', 'the node right after the canonical label must be a fenced block');
  assert.equal(next.lang, 'bash', 'the canonical fence must be a bash fence');
  // The canonical definition is TWO fences: the allocator, then the operation.
  // The label introduces the allocation fence; the operation fence is the next
  // one after it, and only that one carries a body path.
  assert.deepEqual(
    shellLines(next.text),
    ['mktemp -d'],
    'the fence right after the canonical label must be the allocator, and nothing else'
  );
  const opNode = nodes
    .slice(labelIdx + 2)
    .find((node) => node.kind === 'fence' && node.lang === 'bash'
      && carriesBodyDir(node.text) && !isTeardownFence(node.text) && !isCaptureFence(node.text));
  assert.ok(opNode, 'the allocation fence must be followed by the operation fence');

  // Every body-bearing block is that skeleton with its own operation and its own
  // cleanup operand substituted — a per-layer block cleans one file, not the
  // directory the layers above it still need.
  const canonical = skeleton(opNode.text);
  assert.deepEqual(
    canonical,
    ['(', 'set -- 0', '<OPERATION>', '<CLEANUP>', 'exit "$(( $1 ? $1 : ${2:-0} ))"', ')'],
    `the canonical skeleton is not the expected shape: ${JSON.stringify(canonical)}`
  );
  let checked = 0;
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    for (const [idx, block] of bodyBearingBlocks(content).entries()) {
      assert.deepEqual(
        skeleton(block),
        canonical,
        `${name} block #${idx} deviates from the canonical skeleton — a command outside the guard is a failure the guard does not cover:\n${block}`
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 5, `expected every body-bearing block to be checked, saw ${checked}`);
});

/**
 * The grammar of a `gh pr create` / `gh pr edit` invocation, by role rather than
 * by word shape. Checking shapes independently accepted `--title --draft` (the
 * dynamic title silently gone) and `--repo 'other/repo'` (the edit redirected),
 * while rejecting the legitimate `--` terminator and `--flag='value'`.
 *
 * Shared by the guarded-operation test and the document-wide sweep, because a
 * prefix check ("the first three words are `gh pr edit`") accepts
 * `gh pr edit 42 --repo 'other/repo'` and `gh pr edit 42\\X`. `requireAll` is the
 * only difference: inside the guard every layer must carry its full flag set and
 * exactly one body file; a bodyless illustration elsewhere must still be a
 * well-formed, non-redirectable invocation.
 */
function assertPrOperation(where, command, { requireAll }) {
  assert.ok(
    !unquotedSubstitution(command),
    `${where}: command substitution in an executable command:\n${command}`
  );
// Per-subcommand grammar, by role rather than by word shape. Checking
// shapes independently accepted `--title --draft` (the dynamic title
// silently gone) and `--repo 'other/repo'` (the edit redirected), while
// rejecting the legitimate `--` terminator and `--flag='value'`.
const words = commandWords(command);
const subcommand = words[2];
// Distinct schemas: `--head` is create-only and the two forms differ on
// `--base` (create sets it, edit may retarget it); `--draft`/`--fill` have
// no meaning on an edit; only an edit takes a PR number. `required` is
// separate from `valued`: a create that loses `--title` would otherwise
// still parse, and `gh` would prompt or fail rather than use the
// generated, Step 4b-sanitized title the contract promises.
const SCHEMA = {
  create: {
    valued: ['--head', '--base', '--title', '--body-file'],
    // Empty, not `['--draft', '--fill']`. Listing them as "known" authorized
    // them anywhere the required set was also satisfied, so a fully-formed
    // `gh pr create --head … --base … --title … --body-file … --draft` passed
    // both the guarded grammar and the document-wide sweep while opening a
    // materially different PR. A valueless flag earns a slot here only with a
    // behavioral contract and a fixture behind it.
    valueless: [],
    required: ['--head', '--base', '--title', '--body-file'],
    number: false,
  },
  // `required` is unconditional; `requireAll` only chooses which edit rule
  // applies. Relaxing create's set let a bare `gh pr create --fill` pass the
  // sweep — a PR opened from the current branch with a commit-derived title
  // that never passed Step 4b sanitization.
  edit: {
    valued: ['--base', '--title', '--body-file'],
    valueless: [],
    required: ['--body-file'],
    // Outside the guard an edit must change a field the contract actually
    // edits: the title (the title-only illustration) or the body (Step 7b's
    // re-publish). `--base` is deliberately NOT a sole justification —
    // `gh pr edit 42 --base 'develop'` retargets a PR and no contract path asks
    // for that: generic Step 5a smart-diffs title and body, and stacked Phase B
    // aborts when an existing PR's base does not already match. A future base
    // edit needs its own behavioral branch and fixture, not a generic slot here.
    requiredAny: ['--title', '--body-file'],
    // Retargeting a PR is a guarded-stack operation only. Excluding `--base`
    // from `requiredAny` merely stopped it being the SOLE field —
    // `gh pr edit 42 --base 'release' --title 'safe'` still retargeted the PR
    // while looking like a title edit. Outside the guard it is not a flag at
    // all: generic Step 5a smart-diffs title and body, and stacked Phase B
    // aborts unless the existing base already matches.
    guardedOnly: ['--base'],
    number: true,
  },
}[subcommand];
assert.ok(SCHEMA, `${where}: unknown subcommand \`${subcommand}\``);
const valued = new Set(SCHEMA.valued);
const known = new Set([...SCHEMA.valued, ...SCHEMA.valueless]);
const seen = new Set();
let expectValue = null;
let terminated = false;
let numbers = 0;
let bodyPaths = 0;
const takeValue = (flag, word) => {
  assert.ok(
    isCanonicalLiteral(word),
    `${where}: \`${flag}\` must take one complete single-quoted literal — quoted runs joined only by the canonical escape — got \`${word}\`:\n${command}`
  );
  if (flag !== '--body-file') return;
  bodyPaths += 1;
  const path = word.slice(1, -1);
  // The run directory is 0700 and is what cleanup removes; a path that
  // resolves outside it survives cleanup with the private body in it.
  assert.match(
    path,
    /^<PR_BODY_DIR>\/pr-body-[1-9][0-9]*\.md$/,
    `${where}: the body must be a per-layer file inside the run directory, got \`${path}\``
  );
};
for (const [pos, word] of words.entries()) {
  // An unquoted backslash escapes the next character, so `118\\X` reads as
  // the number 118 to a naive scan and reaches gh as `118X`. The contract
  // needs no unquoted escapes, so reject them outright.
  assert.ok(
    !hasUnquotedBackslash(word),
    `${where}: unquoted backslash in \`${word}\` — every dynamic value is single-quote rendered:\n${command}`
  );
  if (pos < 3) continue; // gh pr create|edit — asserted above
  // Structural words — flags, the terminator, the PR selector — are matched on
  // their RAW spelling, never on decoded content. Decoding first deleted the
  // quotes and accepted `42'evil'` and `42''\'''` as the number 42, while the
  // shell hands `gh` the selector `42evil` / `42'` — and `gh pr edit` takes a
  // branch name, so either retargets the edit. Quoting belongs in values, which
  // `isCanonicalLiteral` validates; a structural token has no reason to carry
  // any quote or escape at all.
  if (expectValue) { takeValue(expectValue, word); expectValue = null; continue; }
  if (word === '--') {
    assert.equal(terminated, false, `${where}: a second \`--\` terminator:\n${command}`);
    terminated = true;
    continue;
  }
  if (!terminated && /^--[a-z][a-z-]*=/.test(word)) {
    const flag = word.split('=')[0];
    assert.ok(known.has(flag), `${where}: \`${flag}\` is not a \`gh pr ${subcommand}\` flag:\n${command}`);
    assert.ok(valued.has(flag), `${where}: \`${flag}\` takes no value:\n${command}`);
    assert.equal(seen.has(flag), false, `${where}: \`${flag}\` given twice:\n${command}`);
    seen.add(flag);
    assert.ok(
      isCanonicalLiteral(word.slice(word.indexOf('=') + 1)),
      `${where}: an attached value must be one complete single-quoted literal:\n${word}`
    );
    takeValue(flag, word.slice(word.indexOf('=') + 1));
    continue;
  }
  if (!terminated && word.startsWith('-')) {
    assert.ok(known.has(word), `${where}: \`${word}\` is not a \`gh pr ${subcommand}\` flag — a detached flag must be spelled exactly, with no quoting:\n${command}`);
    assert.equal(seen.has(word), false, `${where}: \`${word}\` given twice:\n${command}`);
    seen.add(word);
    if (valued.has(word)) expectValue = word;
    continue;
  }
  // Past the terminator, or a bare word: the PR number is the only one.
  assert.ok(
    /^\d+$/.test(word) && SCHEMA.number,
    `${where}: \`${word}\` is neither a documented flag, a PR number, nor a quoted value:\n${command}`
  );
  numbers += 1;
}
assert.equal(expectValue, null, `${where}: \`${expectValue}\` has no value:\n${command}`);
assert.equal(numbers, SCHEMA.number ? 1 : 0, `${where}: an edit names exactly one PR, a create names none:\n${command}`);
assert.ok(
  requireAll ? bodyPaths === 1 : bodyPaths <= 1,
  `${where}: exactly one body file per layer:\n${command}`
);
if (!requireAll) {
  for (const flag of SCHEMA.guardedOnly || []) {
    assert.equal(
      seen.has(flag),
      false,
      `${where}: \`${flag}\` is authorized only inside the guarded operation:\n${command}`
    );
  }
}
if (!requireAll && SCHEMA.requiredAny) {
  assert.ok(
    SCHEMA.requiredAny.some((flag) => seen.has(flag)),
    `${where}: \`gh pr ${subcommand}\` must change at least one of ${SCHEMA.requiredAny.join(', ')}:\n${command}`
  );
  return;
}
for (const flag of SCHEMA.required) {
  assert.ok(
    seen.has(flag),
    `${where}: \`gh pr ${subcommand}\` must pass \`${flag}\` — an omitted one is a value the contract promised and did not send:\n${command}`
  );
}
}

test('the guarded operation is only ever a PR create or edit', () => {
  // The skeleton pins the position; this pins what may occupy it. A `gh pr close`
  // or a `git push` slipped in there would satisfy the shape and still be wrong.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    for (const [idx, block] of bodyBearingBlocks(content).entries()) {
      const operation = shellLines(block).find((line) => line.startsWith('gh '));
      assert.ok(operation, `${name} block #${idx} should have a gh operation`);
      assert.ok(
        operation.endsWith('|| set -- "$?"'),
        `${name} block #${idx}: the operation must end with the quoted capture:\n${operation}`
      );
      const { segments, operators } = splitUnquoted(operation);
      assert.equal(
        operators.at(-1),
        '||',
        `${name} block #${idx}: the operation must end in the capture list:\n${operation}`
      );
      assert.equal(
        segments.at(-1),
        'set -- "$?"',
        `${name} block #${idx}: the capture must be exactly \`set -- "$?"\`:\n${operation}`
      );
      for (const [pos, operator] of operators.slice(0, -1).entries()) {
        assert.equal(
          operator,
          '&&',
          `${name} block #${idx}: only \`&&\` may join layers — \`${operator}\` at position ${pos} would run a command the guard does not gate:\n${operation}`
        );
      }
      for (const command of segments.slice(0, -1)) {
        assert.match(
          command,
          /^gh pr (create|edit) /,
          `${name} block #${idx}: only \`gh pr create\`/\`gh pr edit\` may run here, got: ${command}`
        );
        assert.ok(
          !unquotedSubstitution(command),
          `${name} block #${idx}: command substitution in the operation slot:\n${command}`
        );
        assertPrOperation(`${name} block #${idx}`, command, { requireAll: true });
      }
    }
  }
});

/**
 * Prose units outside every fence: a table row, a list item, or a paragraph, each
 * whitespace-normalized so a Markdown line wrap neither hides a construct nor
 * breaks a phrase. Returns [startLine, text].
 */
function proseUnits(content) {
  const units = [];
  let current = null;
  for (const node of markdownNodes(content)) {
    // Every node boundary ends the unit: two paragraphs separated by a fence or a
    // blank line are two instructions, and merging them lets the second inherit
    // an authorizing phrase from the first.
    current = null;
    if (node.kind !== 'prose') continue;
    for (const [offset, raw] of node.text.split('\n').entries()) {
      const lineNo = node.line + offset;
      const line = raw.trim();
      if (!line) { current = null; continue; }
    // A row, a bullet, or a numbered item is its own instruction, not a continuation.
      const standalone = /^\|/.test(line) || /^(\d+\.|[-*])\s/.test(line) || /^#{1,6}\s/.test(line);
      if (!current || standalone) { current = [lineNo, line]; units.push(current); }
      else current[1] += ` ${line}`;
    }
  }
  return units;
}


/** Inline `code spans` of a prose unit — where shell would hide from an English-word scan */
function codeSpans(text) {
  return (text.match(/`[^`]+`/g) || []).map((span) => span.slice(1, -1));
}

const CITES_CANONICAL = /canonical (cleanup )?block/i;

/** Drop an unquoted trailing `#` comment — data to the shell, noise to a scan */
function stripComment(line, startOpen = false) {
  const { chars } = scanShell(line, startOpen);
  let out = '';
  let open = startOpen;
  for (const [i, c] of chars.entries()) {
    const prev = chars[i - 1];
    // A comment word may begin after any unquoted token boundary, not just
    // whitespace: `git fetch --prune origin;# harmless \` is a comment in bash,
    // sh and zsh, so its trailing backslash does not continue the line. Reading
    // only whitespace as a boundary let the next line be joined in and then
    // dropped as comment text, hiding the command it carried.
    const BOUNDARY = /[\s;|&()]/;
    const atWordStart = i === 0 || (prev && isOperative(prev) && BOUNDARY.test(prev.ch));
    if (isOperative(c) && c.ch === '#' && atWordStart) return { text: out.trim(), open };
    if (c.delimiter) open = c.quoted;
    out += c.raw;
  }
  return { text: out.trim(), open };
}

/** Unquoted redirection or process substitution — a side effect a prefix scan cannot see */
function unquotedRedirection(text) {
  return scanShell(text).chars.some((c) => isOperative(c) && (c.ch === '>' || c.ch === '<'));
}

// The read-only inspection commands these documents are authorized to show, as
// EXACT forms rather than prefixes. `git fetch` and `git diff` looked harmless
// as prefixes and are not: `git fetch origin '+evil:refs/heads/main'` rewrites a
// local branch and `git diff "$(id)"` executes. Adding a genuinely new probe
// means adding its exact form here — that friction is the authorization
// boundary doing its job, not a maintenance defect.
const AUTHORIZED_READ_ONLY = new Set([
  "gh pr list --head 'feat/PROJ-42-add-widget' --base 'main' --json number,title,state",
  'gh pr view <PR-number> --json number,title,body,url,baseRefName',
  'gh pr view <number> --json title,body --template \'{{.title}}{{"\\n"}}{{.body}}\'',
  "gh repo view --json nameWithOwner --jq '.nameWithOwner'",
  'gh extension list',
  "git diff 'refs/remotes/origin/main...refs/remotes/origin/feat/PROJ-42-add-widget' --stat",
  "git log --oneline 'refs/remotes/origin/main..refs/remotes/origin/feat/PROJ-42-add-widget'",
  "git ls-remote --heads origin -- 'feat/PROJ-42-add-widget'",
  'git rev-parse --abbrev-ref HEAD',
  'git fetch --prune origin',
  "git rev-parse --verify --quiet 'refs/heads/feat/auth-service'",
  "git rev-parse --verify --quiet 'refs/remotes/origin/feat/auth-service'",
  "gh pr view 'feat/auth-schema' --json number --jq '.number'",
  // Phase A's second fence: the two ancestry booleans the sync table reads.
  // Both directions are needed — OID inequality alone cannot separate
  // LOCAL_AHEAD from REMOTE_AHEAD from DIVERGED.
  "git merge-base --is-ancestor 'refs/heads/feat/auth-service' 'refs/remotes/origin/feat/auth-service'",
  "git merge-base --is-ancestor 'refs/remotes/origin/feat/auth-service' 'refs/heads/feat/auth-service'",
]);

// The run-directory lifecycle and the guard's own control flow, also exact:
// `rm` as a prefix accepts `rm -rf -- /somewhere/else`.
const AUTHORIZED_LIFECYCLE = new Set([
  'mktemp -d',
  // Phase A's not-found guard: absence is an answer, so exit 1 is accepted
  // and anything else still aborts — stack-mode.md § Phase A.
  '[ "$?" = 1 ]',
  // The explicit exits that replaced `set -e` in Phase A. `set -e` inside a
  // subshell cannot carry this: errexit is disabled for a command whose status
  // the caller tests, and that context is inherited into the subshell — POSIX
  // behaviour, measured identical in bash, sh, zsh and dash, not a zsh quirk.
  // So each failure path exits by itself. `exit "$?"`
  // re-raises the failing command's own status; `exit 2` is the fixed status
  // for "this probe answered something the classifier cannot use".
  'exit "$?"',
  'exit 2',
  // Region markers: `--quiet` prints nothing for a missing ref, so without
  // them ABSENT and remote-only emit the same single unlabelled OID.
  "echo 'local:'",
  "echo 'remote:'",
  "echo 'end:'",
  "echo 'local-is-ancestor-of-remote:'",
  // The re-raise: without it the fence prints a captured 128, then `end:`, and
  // exits 0 — a completed classification by every signal an executor can read.
  // It is the trailing `|| exit 2` above that makes the `[` load-bearing.
  '[ "$1" = 0 ]',
  '[ "$1" = 1 ]',
  "echo 'remote-is-ancestor-of-local:'",
  // `--is-ancestor` answers by status, and the fence prints that status rather
  // than a yes/no word — 128 (bad object, not a repository) must not read as
  // "no". Same `set --` idiom as the canonical block: `$?` does not survive.
  'echo "$1"',
  // Teardown seeds with the failing layer's status so cleanup cannot mask it.
  "set -- '<PRIOR_STATUS>'",
  // The digits-only guard on `<PRIOR_STATUS>`. `splitUnquoted` models a
  // command LIST, so `|` and `;;` split a `case` into arms: the one line
  // surfaces here as three segments plus an empty one. Authorized as exact
  // strings rather than by teaching the splitter `case`, because the fence
  // must stay POSIX — a bash-only `${1//[!0-9]/}` would break the fences
  // that are executed under `sh` and `dash`.
  'case "$1" in ' + "''",
  '*[!0-9]*) set -- 2',
  'esac',
  "rm -rf -- '<PR_BODY_DIR>'",
  // Per-layer cleanup: a stacked execute layer removes its own body file, since
  // the layers above it still need the directory.
  "rm -rf -- '<PR_BODY_DIR>/pr-body-1.md'",
  'set -- 0',
  'set -- "$?"',
  // Cleanup's own status, kept behind the operation's — see the canonical block.
  'set -- "$1" "$?"',
  'exit "$(( $1 ? $1 : ${2:-0} ))"',
]);

test('no PR-body command hides where the bash-fence sweep cannot see it', () => {
  // The sweep inspects bash fences. An `untyped` fence — a message template, an
  // output sample — is not one, and a `gh pr edit ... --body-file <path>` sitting
  // in one is still a command a reader will copy: it carried an unquoted
  // `<clean-body-file>` and contradicted the contract's claim that every
  // body-carrying operation goes through the canonical block.
  //
  // Any fence that is not bash, and all prose, must therefore not spell out a
  // body-carrying invocation. Naming the canonical block instead is the fix.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    for (const node of markdownNodes(content)) {
      const isBash = node.kind === 'fence' && node.lang.trim().toLowerCase() === 'bash';
      if (isBash) continue;
      const where = `${name}:${node.line} (${node.kind === 'fence' ? `\`${node.lang || 'untyped'}\` fence` : 'prose'})`;
      for (const line of node.text.split('\n')) {
        // Keyed on a real invocation (`gh pr … --body-file`), not on the flag
        // alone: prose legitimately discusses the flag when explaining why
        // `--body-file /dev/stdin` does not rescue a heredoc.
        assert.ok(
          !(/\bgh pr\b/.test(line) && /--body-file[\s=]/.test(line)),
          `${where}: a body-carrying command outside a bash fence is invisible to the authorization sweep — name the canonical block instead of spelling the command out:\n${line.trim()}`
        );
      }
    }
  }
});

test('no bash fence anywhere in either document runs an unauthorized command', () => {
  // The operation schema above only sees fences that carry a body file, so a
  // fence without one — the title-only illustration, the Phase A probes — was
  // outside it entirely and could become `gh pr close 42` without failing a
  // test. This is the document-wide floor.
  //
  // It authorizes by exact form, not by prefix, and runs the same grammar the
  // guarded operation does. A prefix sweep accepted `( gh pr close 42 )` (first
  // token `(`), `git diff "$(id)"`, and `gh pr edit 42 --repo 'other/repo'`.
  //
  // `git push`, `git rebase`, `git commit` and every `gh stack` subcommand are
  // absent by construction: stack-mode.md prints them for the user to run. A
  // change making one executable fails here. See rules/discretion.md Register #4.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    sweepShellFences(name, content);
  }
});

function sweepShellFences(name, content) {
  {
    for (const [idx, block] of bashFences(content).entries()) {
      for (const line of shellLines(block.text)) {
        for (const raw of splitUnquoted(line).segments) {
          const segment = stripComment(raw).text;
          if (!segment) continue;
          const where = `${name} bash fence #${idx}`;
          // Exact forms are cleared first because they are fully enumerated and
          // reviewed above — including `gh pr view <PR-number>`, whose angle
          // brackets are this project's placeholder convention and would trip
          // the redirection scan below. Structural tokens are authorized only
          // standing alone: as a prefix, `(` authorizes the whole subshell.
          if (segment === '(' || segment === ')') continue;
          // Step 4b / 7b sanitization: an exact script invocation on a file
          // inside the run directory, with the mode as a fixed literal.
          if (SANITIZE_FORM.test(segment)) continue;
          // Step 7b capture: read-only `gh pr view`, redirected to a fixed
          // filename inside the verification directory. See CAPTURE_FORM.
          if (CAPTURE_FORM.test(segment)) continue;
          if (AUTHORIZED_LIFECYCLE.has(segment)) continue;
          if (AUTHORIZED_READ_ONLY.has(segment)) continue;
          // Everything that is not a known-exact string is scanned before it is
          // matched, so a mutation can neither hide a side effect inside an
          // otherwise plausible command nor reach the flag grammar with one.
          assert.ok(
            !unquotedSubstitution(segment),
            `${where}: command substitution runs a command no allowlist can see:\n${segment}`
          );
          assert.ok(
            !unquotedRedirection(segment),
            `${where}: unquoted redirection or process substitution:\n${segment}`
          );
          for (const word of commandWords(segment)) {
            assert.ok(
              !hasUnquotedBackslash(word),
              `${where}: unquoted backslash in \`${word}\` — the shell removes it and this scan would not:\n${segment}`
            );
          }
          if (/^gh pr (create|edit) /.test(segment)) {
            // A command carrying a run-directory body file IS the guarded form,
            // so it is judged by the guarded rules — that is what authorizes the
            // stacked layer's `--base` retarget. The unlock is not a loophole:
            // `<PR_BODY_DIR>` also makes its fence body-bearing, which pulls in
            // the canonical-skeleton and full-schema tests above.
            const guarded = segment.includes('<PR_BODY_DIR>');
            assertPrOperation(where, segment, { requireAll: guarded });
            continue;
          }
          assert.fail(
            `${where}: not an operation this skill is authorized to run. Only \`gh pr create\`/\`gh pr edit\` may mutate; everything else must match an exact read-only form:\n${segment}`
          );
        }
      }
    }
  }
}

test('the fence sweep covers every shell language a reader would execute', () => {
  // Pins SHELL_LANGS. Narrowing it back to lowercase `bash` passed every test
  // while these fences went unswept — the guard existed but nothing held it in
  // place, because the shipped documents happen to use only ```bash.
  const hostile = 'git push --force origin main';
  for (const lang of ['sh', 'shell', 'zsh', 'BASH', 'bash title=example']) {
    assert.throws(
      () => sweepShellFences('synthetic.md', `Intro.\n\n\`\`\`${lang}\n${hostile}\n\`\`\`\n`),
      /not an operation this skill is authorized to run/,
      `a \`${lang}\` fence must be swept like a bash fence`
    );
  }
  // A language that is genuinely not shell stays out of scope — otherwise the
  // sweep would reject every JSON or markdown sample.
  assert.doesNotThrow(
    () => sweepShellFences('synthetic.md', '```json\n{"cmd": "git push --force origin main"}\n```\n')
  );
});

/**
 * The one region allowed to carry shell examples in prose: SKILL.md
 * § Command Rendering's table, which is where the contract's rationale and its
 * anti-pattern illustrations live. Identified by section, not by a marker
 * comment, so a reworded row stays legal and a new row elsewhere does not.
 */
function authorityRegion() {
  const heading = '#### Command Rendering (mandatory) ⚠️';
  const section = extractSection(skillContent, heading);
  assert.ok(section, 'SKILL.md should still have the Command Rendering section');
  const first = skillContent.slice(0, skillContent.indexOf(heading)).split('\n').length;
  return { text: section, first, last: first + section.split('\n').length - 1 };
}

test('the two secondary contract locations each cite the canonical block', () => {
  // Asserted per section, not as a global count: two citations in one section
  // must not stand in for a missing one in the other.
  for (const heading of ['## Shell Safety', '## Phase C']) {
    const section = extractSection(stackContent, heading)
      || proseUnits(stackContent).find(([, t]) => t.startsWith(heading));
    assert.ok(section, `stack-mode.md should still have a ${heading} section`);
    const text = typeof section === 'string' ? section : section[1];
    assert.match(
      text.replace(/```[\s\S]*?```/g, ''),
      CITES_CANONICAL,
      `${heading} must cite the canonical block rather than restate the algorithm`
    );
  }
});

test('the authority region states the contract and cites the canonical block', () => {
  const cleanup = proseUnits(authorityRegion().text).find(([, text]) => text.startsWith('| Cleanup |'));
  assert.ok(cleanup, 'the Command Rendering table should still carry the Cleanup row');
  assert.match(cleanup[1], CITES_CANONICAL, 'the Cleanup row must point at the block that defines the shape');
  // Even here, rationale only — the *how* belongs to the fence.
  for (const [pattern, why] of [[/set --\s/, 'seeds or captures the status'], [/=\$\?/, 'captures a status']]) {
    assert.ok(!pattern.test(cleanup[1]), `the Cleanup row ${why} — that is the canonical block's job:\n${cleanup[1]}`);
  }
});

/**
 * CommonMark code spans: a run of N backticks opens, the next run of exactly N
 * closes. Handles `` `x` `` and spans containing a backtick — a naive
 * /`[^`]+`/ mis-pairs those and silently hands back garbage to scan.
 */
function codeSpansOf(text) {
  const spans = [];
  const runs = [...text.matchAll(/`+/g)];
  for (let i = 0; i < runs.length; i += 1) {
    const open = runs[i];
    const close = runs.slice(i + 1).find((run) => run[0].length === open[0].length);
    if (!close) continue;
    spans.push(text.slice(open.index + open[0].length, close.index).trim());
    i = runs.indexOf(close);
  }
  return spans;
}

/**
 * The complete set of shell snippets prose may show, each tied to the unit that
 * legitimately carries it. Every one is a rationale or an anti-pattern
 * illustration; none is an instruction. Adding a snippet here is a deliberate
 * edit, which is the point — the *how* belongs to the canonical block.
 */
const PROSE_SHELL_ALLOWLIST = [
  // Bound to the *complete* normalized unit by digest, not a prefix: a short
  // selector like `| Cleanup |` also matches a second row that starts the same
  // way, and text appended to the row inherits its exceptions. `snippets` is an
  // exact multiset, so a repeated occurrence is a new fact needing a new entry.
  // Rewording an allowlisted unit changes its digest on purpose — the failure
  // message prints the new one, and updating it is a deliberate act.
  { file: 'SKILL.md', label: 'Command Rendering preamble — the metacharacters a branch may contain', digest: '0f95f0a74591', snippets: [';'] },
  // Rationale for Phase A's second fence: it names the idiom the fence uses
  // (and the canonical block already defines) in order to explain why a status
  // is printed instead of a yes/no word. Not an instruction — the fence above
  // it is what runs.
  { file: 'stack-mode.md', label: 'Phase A — why the ancestry fence prints a raw status and re-raises anything else', digest: 'bbb98372a488', snippets: ['[ "$1" = 0 ] || [ "$1" = 1 ] || exit 2', 'exit', 'set -e', 'set -- 0', 'set -- "$?"'] },
  // Rationale for dropping `set -e` from the Phase A fences: it quotes the
  // reproduction (`( set -e; false; echo REACHED )` under a status-tested
  // caller — POSIX behaviour, identical in bash, sh, zsh and dash) that shows
  // why the option could not carry the policy, and names the explicit exit
  // that replaced it. The fence above it is what runs.
  { file: 'stack-mode.md', label: 'Phase A — why the fences exit explicitly instead of relying on set -e', digest: '3025e5cd9957', snippets: ['set -e', 'set -e', '( set -e; false; echo REACHED )', 'set -e', 'set -e', '|| exit "$?"'] },
  // Rationale for retiring the bare-placeholder exemption: it quotes the
  // unquoted form that used to ship (`set -- <PRIOR_STATUS>`) to say why it
  // executed a hostile value at substitution time, and names the `case` guard
  // that covers the arithmetic re-evaluation behind it. The fence above it is
  // what runs.
  { file: 'SKILL.md', label: 'Command Rendering — why <PRIOR_STATUS> is guarded rather than trusted', digest: '257692c31a1a', snippets: ['set -- <PRIOR_STATUS>', 'case', '$(( $1 ? … ))', '$1'] },
  { file: 'SKILL.md', label: 'Rule 1 — what double quotes fail to suppress', digest: 'b3f2236dc903', snippets: ['git rev-parse "refs/heads/$BRANCH"'] },
  { file: 'SKILL.md', label: 'How the path is carried — why a captured variable fails', digest: '7b092df35ec4', snippets: ['DIR=$(mktemp -d)', '$DIR', 'rm -rf "$TMPDIR"'] },
  { file: 'SKILL.md', label: 'Cleanup — the caller states the shape defends against', digest: 'c9f130a27d7d', snippets: ['readonly STATUS=9', 'rm', 'rm', 'Bash(rm:*)'] },
  // Rationale, not instruction: it names the shells in which an unguarded `rm`
  // replaces the operation's status, which is why the cleanup is guarded.
  { file: 'SKILL.md', label: 'Why cleanup is guarded too — the status a failing rm would replace', digest: '118e2ede8b9d', snippets: ['rm', 'set -e', 'rm'] },
  // Rationale in a summary row: it says why the probes are guarded, naming the
  // caller state an unguarded probe would abort under.
  { file: 'SKILL.md', label: 'Phase A summary row — why the fence exits explicitly and the probes are guarded', digest: '051d7b94492c', snippets: ['\\|\\| exit', 'set -e'] },
  // Rationale for the probe guard: absence is an expected answer, so exit 1 is
  // accepted and the trailing `|| exit 2` is what stops anything else from
  // continuing. It quotes the guard it explains; the fence above is what runs.
  { file: 'stack-mode.md', label: 'Phase A — why each probe is guarded and what the trailing exit adds', digest: '4b7a4f6f4f8c', snippets: ['git rev-parse … || exit "$?"', '|| [ "$?" = 1 ] || exit 2', '|| exit 2'] },
  { file: 'stack-mode.md', label: 'Phase A — why refs must be fully qualified', digest: 'ea9990656a0b', snippets: ['"refs/heads/$BRANCH"'] },
  // Rationale for the guard itself: absence is a state Phase A must reach, and
  // the paragraph names the caller state an unguarded probe would abort under.
  // Rationale for the one place the option-terminator rule does not apply.

  // Rationale for the teardown fence: it names the caller state that would
  // skip a chained cleanup, and the command whose status must not win.
  { file: 'stack-mode.md', label: 'Phase C — why teardown is its own fence and carries a status', digest: '38adc2d5b512', snippets: ['set -e', 'rm'] },
  { file: 'stack-mode.md', label: 'Shell Safety preamble — metacharacters git accepts in a ref', digest: '9613d0050fb8', snippets: [';'] },
  { file: 'stack-mode.md', label: 'Shell Safety rule 1 — displayed commands', digest: 'd1d82c8e628d', snippets: ['"refs/heads/$BRANCH"'] },
  { file: 'stack-mode.md', label: 'Shell Safety rule 4 — the caller states, named not spelled', digest: '8f7f3ae6b5eb', snippets: ['set -e', 'readonly'] },
  // Rationale for withholding the matching line from diagnostics: it names
  // the shape of a line that would put a credential into a log.
  { file: 'SKILL.md', label: 'Step 4b — why a matched line is never echoed', digest: '0d0a70a82d9f', snippets: ['Generated by GPT-4; token=…'] },
];

/** Does this code span look like shell rather than an identifier or a path? */
// Deliberately shape-based, not head-based: a bare `gh pr edit` in prose is the
// NAME of a command, and flagging every mention of a name buries the signal. The
// commands that must never hide in prose are the mutating ones, and they get
// their own exact-form test below rather than a widened shape here.
const SHELL_SHAPED = /\$\{?[A-Za-z_0-9]|[A-Za-z_][A-Za-z0-9_]*=|\brm\b|\b(read|case|esac|eval|exec|trap|set|unset|export|readonly|exit|return)\b|;/;

/**
 * Mutating command forms that may appear OUTSIDE a shell fence, each with the
 * reason it is not an instruction to this skill. Exact strings: `git push` (the
 * name) is a reference, `git push --force origin main` is not, and only an
 * exact-form list can tell them apart. A new entry is a review decision.
 */
const NON_EXECUTABLE_MUTATING = new Map([
  // Names of commands, used to talk about them.
  ['gh pr create', { kind: 'name', where: ['span'] }],
  ['gh pr edit', { kind: 'name', where: ['span'] }],
  ['git push', { kind: 'name', where: ['span'] }],
  ['git rebase', { kind: 'name', where: ['span'] }],
  // Templates in routing tables — placeholders, not runnable.
  ['gh pr create --head \'<head>\' --base \'<base>\'', { kind: 'template', where: ['span'] }],
  ['gh pr edit <number>', { kind: 'template', where: ['span'] }],
  // `gh pr edit <number>` with no `--base`: the routing table's edit row. An
  // existing PR is already on the declared base (Phase B admits no other
  // state), so resending it could only revert a concurrent human retarget.
  ['gh pr edit <number>', { kind: 'template', where: ['span'] }],
  // Read-only probes and help.
  ['gh pr create --help', { kind: 'read-only', where: ['span'] }],
  ['git merge-base --is-ancestor origin/<base> origin/<head>', { kind: 'read-only', where: ['span'] }],
  ["git merge-base --is-ancestor 'refs/remotes/origin/<base>' 'refs/remotes/origin/<head>'", { kind: 'read-only', where: ['span'] }],
  ["git merge-base --is-ancestor 'refs/remotes/origin/<lower>' 'refs/remotes/origin/<upper>'", { kind: 'read-only', where: ['span'] }],
  // Printed for the USER to run. This skill never executes them — that is the
  // whole of Anchor Register #4 as it applies here.
  ["git push origin -- 'b1' 'b2' 'b3'", { kind: 'user-run', where: ['span'] }],
  ['gh stack init/add/submit', { kind: 'user-run', where: ['span'] }],
  ['gh stack init/add/submit/rebase/push/modify', { kind: 'user-run', where: ['span'] }],
  ['gh stack push', { kind: 'user-run', where: ['span'] }],
  ['gh stack rebase --upstack', { kind: 'user-run', where: ['span'] }],
  // Anti-pattern illustration in the rationale for literal-path substitution.
  ['rm -rf "$TMPDIR"', { kind: 'anti-pattern', where: ['span'] }],
]);

const MUTATING_FORM =
  /\b(?:git\s+(?:push|rebase|commit|reset|stash|checkout|merge|add)\b|gh\s+pr\s+(?:close|merge|create|edit|reopen|delete)\b|gh\s+stack\s+[a-z]|rm\s+-rf\b)/;

test('every mutating command outside a shell fence is an exact allowlisted non-instruction', () => {
  // The bash-fence sweep is blind to prose, inline spans, and non-shell fences —
  // and that is where an instruction is most plausible, because it reads as
  // narration. `gh pr close 42` in a sentence is still a command a reader runs.
  const seen = new Set();
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    sweepMutatingForms(name, content, seen);
  }
  for (const [form, entry] of NON_EXECUTABLE_MUTATING) {
    assert.ok(
      entry.where.some((w) => seen.has(`${form}@${w}`)),
      `stale allowlist entry, no document shows it: ${form}`
    );
  }
});

test('an unallowlisted mutating command in prose is rejected', () => {
  // Pins the allowlist lookup itself. Replacing it with `true` passed, because
  // every form the shipped documents contain is already allowlisted — so the
  // negative case has to be supplied.
  assert.throws(
    () => sweepMutatingForms('synthetic.md', 'Then run `gh pr close 42` to tidy up.\n', new Set()),
    /a mutating command outside a shell fence/,
    'a mutating command in prose must be rejected unless allowlisted'
  );
  assert.throws(
    () => sweepMutatingForms('synthetic.md', '```text\ngit push --force origin main\n```\n', new Set()),
    /a mutating command outside a shell fence/,
    'a non-shell fence is not a hiding place either'
  );
  // An allowlisted name still passes, so the rule is not "no mention at all".
  assert.doesNotThrow(
    () => sweepMutatingForms('synthetic.md', 'This skill never runs `git push`.\n', new Set())
  );
  // Context binding: the same string allowlisted as a name in a sentence must
  // not pass as a copyable line inside a message template.
  assert.throws(
    () => sweepMutatingForms('synthetic.md', '```text\ngit push\n```\n', new Set()),
    /allowlisted only as span, not as line/,
    'a prose exception must not authorize template text'
  );
  // Unmarked prose has no form to bind an exception to, so it fails closed.
  assert.throws(
    () => sweepMutatingForms('synthetic.md', 'Then run git push --force origin main to finish.\n', new Set()),
    /a mutating command in unmarked prose/,
    'a command without backticks must not slip past the span sweep'
  );
  // `git add` is a mutation the earlier pattern did not name at all.
  assert.throws(
    () => sweepMutatingForms('synthetic.md', 'Run `git add -A` first.\n', new Set()),
    /must be an allowlisted non-instruction/,
    'git add belongs to the mutating set'
  );
  // A fence in a shell dialect the sweep did not previously recognize is
  // handled by the fence grammar, not waved through as prose.
  assert.ok(
    bashFences('```dash\ngit push --force origin main\n```\n').length === 1,
    'dash fences must reach the authorization sweep'
  );
});

function sweepMutatingForms(name, content, seen) {
  for (const node of markdownNodes(content)) {
    if (node.kind === 'fence' && SHELL_LANGS.has(fenceLang(node))) continue;
    // Three contexts, checked separately because they authorize differently:
    // an inline span is a name a sentence refers to; a bare line in a message
    // template is text the reader copies; and prose with the spans removed is
    // where a command would hide if someone simply forgot the backticks.
    const candidates = [];
    for (const span of codeSpansOf(node.text)) candidates.push(['span', span]);
    if (node.kind === 'fence') {
      for (const line of node.text.split('\n')) {
        if (!line.includes('`')) candidates.push(['line', line]);
      }
    } else {
      // Fail closed on unbackticked prose: a runnable command must be marked up
      // as one, so it can be attributed to a context at all. No exact-form
      // allowlist applies here — there is no form to bind an exception to.
      for (const line of stripCodeSpans(node.text).split('\n')) {
        const bare = stripComment(line).text;
        assert.ok(
          !MUTATING_FORM.test(bare),
          `${name}:${node.line}: a mutating command in unmarked prose is invisible to every allowlist — put it in backticks or a fence:\n${line.trim()}`
        );
      }
    }
    for (const [where, raw] of candidates) {
      const text = stripComment(raw).text.trim();
      if (!MUTATING_FORM.test(text)) continue;
      const entry = NON_EXECUTABLE_MUTATING.get(text);
      assert.ok(
        entry,
        `${name}:${node.line}: a mutating command outside a shell fence must be an allowlisted non-instruction — if a reader would run it, it belongs in a fence the sweep can authorize:\n${text}`
      );
      // Context binding: an exception earned as a name inside a sentence does
      // not also authorize the same string as a copyable line in a template.
      assert.ok(
        entry.where.includes(where),
        `${name}:${node.line}: '${text}' is allowlisted only as ${entry.where.join('/')}, not as ${where} — a prose exception cannot authorize template text`
      );
      seen.add(`${text}@${where}`);
    }
  }
}

/** Blank out inline code spans so the remaining text is prose only. */
function stripCodeSpans(text) {
  return text.replace(/`+[^`]*`+/g, ' ');
}

test('neither document hides a command in an indented code block', () => {
  // CommonMark treats a four-space-indented run as a code block with no info
  // string, so it has no language for the fence sweep to key on and every line
  // of it is executable text a reader can copy. Fail closed: the supported form
  // is a fenced block.
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    const lines = content.split('\n');
    let inFence = false;
    let blank = true;
    for (const [idx, line] of lines.entries()) {
      if (/^\s*(`{3,}|~{3,})/.test(line)) { inFence = !inFence; blank = false; continue; }
      if (inFence) continue;
      if (!line.trim()) { blank = true; continue; }
      // Only a run that STARTS after a blank line is an indented code block;
      // continuation lines of a list item are indented too and are not code.
      const indented = /^ {4,}\S/.test(line) && !/^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*\|/.test(line);
      if (blank && indented) {
        assert.ok(
          !/^\s*(git|gh|mktemp|rm|npm|node|bash|sh|curl|chmod|sudo)\s/.test(line),
          `${name}:${idx + 1}: a command in an indented code block is invisible to the fence sweep — use a fenced bash block:\n${line.trim()}`
        );
      }
      blank = false;
    }
  }
});

test('prose may show only the shell snippets explicitly allowed, in the units that carry them', () => {
  // Not a section-wide exemption: skipping all of § Command Rendering let a
  // contradictory instruction hide beside the rationale. The allowlist is the
  // exemption, and it is bound to one complete unit in one file.
  const used = new Set();
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    for (const [lineNo, text] of proseUnits(content)) {
      const found = codeSpansOf(text).filter((span) => SHELL_SHAPED.test(span));
      if (!found.length) continue;
      const digest = createHash('sha256').update(text).digest('hex').slice(0, 12);
      const entry = PROSE_SHELL_ALLOWLIST.find((item) => item.file === name && item.digest === digest);
      assert.ok(
        entry,
        `${name}:${lineNo} shows shell in prose from a unit that is not allowlisted (digest ${digest}): ${JSON.stringify(found)}\nUnit: ${text.slice(0, 70)}…\nIf this is rationale, add the entry; if it is an instruction, it belongs in the canonical block; if you reworded an allowlisted unit, update its digest.`
      );
      assert.deepEqual(
        [...found].sort(),
        [...entry.snippets].sort(),
        `${name}:${lineNo} (${entry.label}): the shell snippets in this unit changed — every occurrence is allowlisted individually`
      );
      used.add(`${name}:${digest}`);
    }
  }
  // A stale entry is a hole: it would keep authorizing a snippet nobody reviews.
  for (const item of PROSE_SHELL_ALLOWLIST) {
    assert.ok(used.has(`${item.file}:${item.digest}`), `stale allowlist entry, no unit matches it: ${item.label}`);
  }
});

test('no prose states a status, deletion, or control-flow algorithm in plain text', () => {
  // Backticks are optional for the writer, so the scan must not depend on them.
  // These patterns all carry shell punctuation, so they do not fire on English.
  const forbidden = [
    [/set --\s/, 'seeds or captures a status'],
    [/=\$\?/, 'captures a status into a named variable'],
    [/\b(exit|return)\s+"?\$\{?[A-Za-z_0-9]/, 're-raises a status'],
    [/\brm\s+(-|--)/, 'deletes the run directory'],
    [/;\s*(then|fi|else|do|done|esac)\b/, 'carries shell control flow'],
    [/;;/, 'carries a case arm'],
    [/\[\s+"?\$/, 're-raises through a test expression'],
    [/\|\|\s*[A-Za-z_][A-Za-z0-9_]*=/, 'captures into a named variable after `||`'],
    [/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/, 'expands a variable'],
    [/\b[A-Za-z_][A-Za-z0-9_]*=[^\s=]/, 'assigns a variable'],
  ];
  let checked = 0;
  for (const [name, content] of [['SKILL.md', skillContent], ['stack-mode.md', stackContent]]) {
    for (const [lineNo, text] of proseUnits(content)) {
      // Code spans are governed by the allowlist above; this is what is left.
      let plain = text;
      for (const span of codeSpansOf(text)) plain = plain.split(`\`${span}\``).join(' ');
      plain = plain.replace(/`+/g, ' ');
      for (const [pattern, why] of forbidden) {
        assert.ok(
          !pattern.test(plain),
          `${name}:${lineNo} ${why} in plain prose — the canonical block is where the shape lives:\n${plain}`
        );
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 40, `expected a broad sweep of prose units, saw ${checked}`);
});

test('a <PRIOR_STATUS> that is not a number cannot execute inside the teardown arithmetic', () => {
  // `<PRIOR_STATUS>` USED to be exempt from single-quote rendering, on the
  // reasoning that an arithmetic operand must not be quoted. It is now quoted
  // like every other value (SKILL.md § Command Rendering), because the
  // unquoted `set -- <PRIOR_STATUS>` executed a hostile value at substitution
  // time — before any arithmetic ran. The `case` line is the second layer:
  // `$(( $1 ? … ))` re-evaluates the operand's CONTENTS as an expression.
  const teardown = bashFences(bothContents).map((n) => n.text).filter(isTeardownFence);
  assert.equal(teardown.length, 3, 'every teardown site ships the same fence');
  const sandbox = mkdtempSync(join(tmpdir(), 'create-pr-prior-'));
  try {
    const runDir = join(sandbox, 'run');
    mkdirSync(runDir);
    const marker = join(sandbox, 'executed');
    const hostile = `a[$(touch ${marker})]`;
    // Function replacements: `$&` and friends in a string replacement would be
    // rewritten by JS before the shell ever saw them.
    const render = (lines) => lines.join('\n')
      .replace('<PRIOR_STATUS>', () => hostile)
      .replace("'<PR_BODY_DIR>'", () => shellRender(runDir));

    for (const shell of shellNames()) {
      const r = spawnSync(shell, ['-e', '-c', render(shellLines(teardown[0]))], { encoding: 'utf8' });
      assert.equal(existsSync(marker), false,
        `${shell}: the arithmetic must not evaluate the operand's contents`);
      assert.equal(r.status, 2, `${shell}: a non-numeric prior status must degrade to 2`);
    }

    // Negative control — remove the guard and the same value runs a command,
    // and the fence exits 0 while doing it.
    const lines = shellLines(teardown[0]);
    const unguarded = lines.filter((l) => !l.startsWith('case '));
    assert.equal(unguarded.length, lines.length - 1, 'the mutation must remove exactly the guard line');
    const bad = spawnSync('bash', ['-e', '-c', render(unguarded)], { encoding: 'utf8' });
    assert.equal(existsSync(marker), true, 'without the guard the operand executes — this is the defect');
    assert.equal(bad.status, 0, 'and it reports success, masking the status it was meant to carry');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('stack mode defines the status table its requirements make the run\'s report', () => {
  // FR-6 and UC-3 make the status table the terminal output of a stack run, and
  // 2-tech-spec.md's §3.1 diagram ends both branches on it. It was specified in
  // three places and defined in none, which is how a documented success
  // condition ships missing.
  const section = stackContent.split('### Stack status table')[1];
  assert.ok(section, 'stack-mode.md must define the status table');
  for (const column of ['`Head`', '`Base`', '`PR`', '`Commits`', '`Sync`', '`State`']) {
    assert.ok(section.includes(column), `the status table must define the ${column} column`);
  }
  // The two properties that make it a report rather than a success message.
  assert.match(section, /every declared layer/,
    'a run that stopped early must still report the layers it never reached');
  assert.match(section, /dry-run and `--execute` alike/,
    'the table is not an execute-only artifact');
  // Sync values must be the same closed set Phase A classifies into.
  for (const value of ['IN_SYNC', 'LOCAL_AHEAD', 'ABSENT', 'NO_SUCH_BRANCH', 'REMOTE_AHEAD', 'DIVERGED']) {
    assert.ok(section.includes(value), `the Sync column must carry Phase A's ${value} verbatim`);
  }
});

test('stack mode writes one title file per layer', () => {
  // Phase C reuses Step 4b, whose `title` mode takes a file. stack-mode.md
  // never named that file, so an implementation following it would write no
  // title file and the sanitizer would exit 2 on every stacked run.
  assert.match(stackContent, /pr-title-<N>\.txt/,
    'the per-layer title file must be named where Phase C is defined');
  assert.match(stackContent, /Titles are files too, one per layer/,
    'and its lifecycle must be stated, not left implied by SKILL.md');
});

test('the published title is rendered from the file the scan read, not from a second copy', () => {
  // Scope, stated precisely, because the earlier name for this test claimed more
  // than it shows. What it establishes is that the WORKFLOW reads one source: the
  // rendered `--title` follows the file, so the generator's own string cannot be
  // published behind the scan's back. What it does NOT establish — and cannot,
  // because scan and publish are separate processes over a mutable path — is that
  // the published bytes carry a verdict. A concurrent same-user writer defeats
  // that, and the test below records it rather than leaving it implied.
  //
  // `gh` has no `--title-file`, so the title is the field where the workflow
  // could most easily diverge on its own: rendering from the generator's string
  // would make the two identical by construction and notice nothing.
  assert.match(
    skillContent,
    /read back from the file step 3 scanned/,
    'SKILL.md must state that the published title comes from the scanned file'
  );
  const dir = mkdtempSync(join(tmpdir(), 'create-pr-title-'));
  try {
    const titlePath = join(dir, 'pr-title-1.txt');
    writeFileSync(titlePath, 'feat: [PROJ-42] Add auth schema\n');
    const template = "gh pr create --title 'feat/auth-schema' --body-file '<PR_BODY_DIR>/pr-body-1.md'";
    const layer = { branch: 'feat/auth-schema', title: 'NEVER-PUBLISHED-SENTINEL' };
    const before = renderLayer(template, layer, '/tmp/body.md', titlePath);
    assert.ok(before.includes('Add auth schema'), 'the rendered title must come from the file');
    assert.ok(!before.includes('NEVER-PUBLISHED-SENTINEL'), 'no second copy may reach the command');
    // Change only the file: if it is the source, the rendered command follows.
    writeFileSync(titlePath, 'fix: [PROJ-99] Rewritten after regeneration\n');
    const after = renderLayer(template, layer, '/tmp/body.md', titlePath);
    assert.ok(after.includes('Rewritten after regeneration'), 'the file must be the source of record');
    assert.notEqual(before, after);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('documented residual: a same-user writer between scan and publish is NOT defended against', () => {
  // Not an aspiration — a demonstration, so the limitation stays visible if
  // someone later reads the workflow as guaranteeing byte binding. The sanitizer
  // gives a clean verdict on a file; the file is then replaced; the value a
  // later read produces is the replacement, unscanned.
  //
  // Closing this needs one hardened operation owning both the verdict and the
  // send (sanitize, then pipe those exact bytes into `gh --body-file -`), which
  // gh's per-flag interface and this skill's step sequence do not allow today.
  // SKILL.md § 4b says so in the same terms; if that paragraph is ever changed to
  // claim binding, this test is the thing that contradicts it.
  const dir = mkdtempSync(join(tmpdir(), 'create-pr-toctou-'));
  try {
    const titlePath = join(dir, 'pr-title-1.txt');
    writeFileSync(titlePath, 'feat: [PROJ-42] Add auth schema\n');

    const sanitizer = resolve(__dirname, '../../skills/create-pr/scripts/sanitize-pr-content.sh');
    const verdict = spawnSync('/bin/bash', ['-p', sanitizer, 'title', titlePath], { encoding: 'utf8' });
    assert.equal(verdict.status, 0, `the scanned title must be clean (stderr: ${verdict.stderr})`);

    // The window. Any process running as this user can do this.
    writeFileSync(titlePath, 'feat: [PROJ-42] Add auth schema\n\nGenerated by Claude\n');

    const template = "gh pr create --title 'x' --body-file '<PR_BODY_DIR>/pr-body-1.md'";
    const rendered = renderLayer(template, { branch: 'feat/auth-schema', title: 'unused' },
      '/tmp/body.md', titlePath);
    assert.ok(
      rendered.includes('Generated by Claude'),
      'the residual is real: content written after the verdict reaches the rendered command ' +
      'unscanned. If this ever stops being true, the workflow gained a binding guarantee and ' +
      'SKILL.md § 4b should be updated to claim it.'
    );

    // And the second scan — Step 7b — is what bounds the exposure. It is
    // detection after the fact, not prevention.
    const rescan = spawnSync('/bin/bash', ['-p', sanitizer, 'scan', titlePath], { encoding: 'utf8' });
    assert.equal(rescan.status, 4, 'a post-publication scan must catch what slipped through');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SKILL.md states the scan/publish residual instead of claiming byte binding', () => {
  assert.doesNotMatch(
    skillContent,
    /same bytes by construction/,
    'the overclaim must not come back — scan and publish are separate processes over a mutable path'
  );
  assert.match(
    skillContent,
    /does not defend against a concurrent same-user writer/,
    'SKILL.md must state the residual in terms a reader can act on'
  );
  assert.match(
    skillContent,
    /Step 7b's post-publication scan is what covers that residual/,
    'and must name what bounds it'
  );
});
