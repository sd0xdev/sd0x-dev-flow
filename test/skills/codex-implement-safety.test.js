'use strict';
// The two commands `skills/codex-implement/SKILL.md` § Step 0 and § 3b tell the model to run are the
// only thing standing between a Codex implementation run and two irreversible outcomes: overwriting
// a hidden-state tracked file with no rollback, and printing a created secret into the transcript.
// They are prose, so nothing would otherwise execute them — this suite extracts them FROM THE
// DOCUMENT and runs them, which is the only way a documented command can be known to work.
// Found by review 2026-09-04: the first version of the scan block could not execute at all
// (`require` on a bare relative specifier), and the first index probe missed `skip-worktree`.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const ROOT = resolve(__dirname, '../..');
const SKILL = fs.readFileSync(join(ROOT, 'skills/codex-implement/SKILL.md'), 'utf8');

// Extract by content, not by position: a fenced ```bash block whose body starts with `node -e`.
// Any trailing text after the closing quote is captured too, because whether the document appends
// arguments to the command line is itself the security question (see the shell-boundary test).
const nodeBlocks = [...SKILL.matchAll(/```bash\n(node -e '[\s\S]*?')([^\n]*)\n```/g)]
  .map((m) => ({ script: m[1], trailer: m[2].trim() }));

// Run it through a REAL SHELL, exactly as the document is written, because the shell is where the
// interesting failure lives: a created filename is attacker-chosen, and anything the document
// interpolates into this command line is expanded before node starts.
// `home` overrides HOME so the scanner's plugin-copy search is HERMETIC. Without it, this suite
// would pass on a machine with the plugin installed for the wrong reason: every trust test below
// would be satisfied by the real plugin copy and would prove nothing about the in-repo rules.
// `args` stands in for the placeholders the document tells the operator to substitute — for the
// scanner, the redactor path and digest that Step 0 pinned before the dispatch.
const runNodeBlock = (block, cwd, { home = cwd, args = [], env = {} } = {}) => {
  // Reproduce the DOCUMENTED construction: substitute each value into the single-quoted slot the
  // trailer already shows, escaping an embedded apostrophe the way the document says to. Adding
  // quoting the document does not have would test a command nobody runs — which is exactly how an
  // unquoted invocation survived a passing suite.
  let cmd = block.script;
  if (block.trailer) {
    const slots = [...block.trailer.matchAll(/'<[^>]*>'/g)];
    assert.equal(slots.length, args.length, 'one value per documented slot');
    let trailer = block.trailer;
    for (const [slot] of slots) {
      trailer = trailer.replace(slot, `'${String(args.shift()).replace(/'/g, "'\\''")}'`);
    }
    cmd = `${block.script} ${trailer}`;
  }
  return spawnSync('/bin/sh', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, ...env } });
};

// The three documented commands, by role. Index order is asserted in the first test below.
const probe = () => nodeBlocks[0];
const pin = () => nodeBlocks[1];

// Step 0 pins the redactor by digest; the scanner is given that pair. Tests compute it the same way.
const pinOf = (p) => [p, createHash('sha256').update(fs.readFileSync(p)).digest('hex')];

const mkrepo = () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'ci-safety-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'test');
  return { dir, git };
};

describe('the SKILL.md commands are extractable and are the ones under test', () => {
  test('exactly two node commands are documented, and both are non-trivial', () => {
    assert.equal(nodeBlocks.length, 3,
      'Step 0 index probe, Step 0 redactor pin, Step 3b content scan — a change in count means '
      + 'this suite tests the wrong thing');
    for (const b of nodeBlocks) assert.ok(b.script.length > 200, 'a stub would pass every assertion below');
    // Slice off both the `node -e '` prefix and the closing quote: what is left is the script body,
    // and any apostrophe in it would have ended the quote early.
    for (const b of nodeBlocks) assert.doesNotMatch(b.script.slice("node -e '".length, -1), /'/,
      'an apostrophe inside `node -e \'…\'` closes the quote: the rest of the script is then read '
      + 'as shell. Measured — a comment saying "the plugin\'s parent" broke the whole command');
    // The two Step 0 commands take nothing. The scanner takes exactly the two values Step 0
    // produced — never a created filename, which is what the shell-injection rule is about.
    assert.equal(nodeBlocks[0].trailer, '', 'the index probe takes no arguments');
    assert.equal(nodeBlocks[1].trailer, '', 'the pin command takes no arguments');
    assert.match(nodeBlocks[2].trailer,
      /^-- '<the path Step 0 printed>' '<the digest Step 0 printed>'$/,
      'the scanner takes the pinned path and digest, after `--`, each SINGLE-QUOTED — an ordinary '
      + 'installation path containing a space would otherwise split into two arguments');
  });
});

describe('Step 0 index probe: every hidden-state bit is flagged, whatever its letter', () => {
  let repo;
  before(() => {
    repo = mkrepo();
    for (const f of ['clean.txt', 'assumed.txt', 'skipped.txt', 'both.txt']) {
      fs.writeFileSync(join(repo.dir, f), `${f}\n`);
    }
    repo.git('add', '.');
    repo.git('commit', '-qm', 'init');
  });
  after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));

  test('a clean index reports (none)', () => {
    const r = runNodeBlock(probe(), repo.dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '(none)', 'nothing is flagged before any bit is set');
  });

  test('assume-unchanged (tag h), skip-worktree (tag S) and both (tag s) are each flagged', () => {
    // The measured tags, and the reason the predicate is "not H" rather than "lowercase":
    // `git ls-files -v` lowercases only the assume-unchanged mark, so skip-worktree stays `S`.
    repo.git('update-index', '--assume-unchanged', 'assumed.txt');
    repo.git('update-index', '--skip-worktree', 'skipped.txt');
    repo.git('update-index', '--assume-unchanged', '--skip-worktree', 'both.txt');
    const out = runNodeBlock(probe(), repo.dir).stdout;
    assert.match(out, /assumed\.txt/, 'assume-unchanged (h) must be flagged');
    assert.match(out, /skipped\.txt/, 'skip-worktree (S) must be flagged — the case-based test missed this one');
    assert.match(out, /both\.txt/, 'both bits (s) must be flagged');
    assert.doesNotMatch(out, /clean\.txt/, 'an ordinary cached file (H) is not a finding');
  });

  test('a flagged file outside the invocation directory is still reported', () => {
    // The nested-invocation control, and the reason the production probe resolves the toplevel:
    // `git ls-files` is path-limited to the cwd subtree, so a probe run from `nested/` would see a
    // fraction of the index, report a clean tree, and let the workspace-write child overwrite a
    // hidden-state file elsewhere. Restoring the cwd-scoped call must fail HERE, not only in a
    // root-level test that could never notice.
    fs.mkdirSync(join(repo.dir, 'nested', 'deeper'), { recursive: true });
    fs.writeFileSync(join(repo.dir, 'nested', 'inside.txt'), 'inside\n');
    repo.git('add', '.');
    repo.git('commit', '-qm', 'nested');
    repo.git('update-index', '--assume-unchanged', 'assumed.txt');   // at the ROOT, not in nested/
    const out = runNodeBlock(probe(), join(repo.dir, 'nested', 'deeper')).stdout;
    assert.match(out, /assumed\.txt/,
      'a flagged file above the invocation directory must still stop the run');
    repo.git('update-index', '--no-assume-unchanged', 'assumed.txt');
  });

  test('clearing the bits returns the probe to (none)', () => {
    repo.git('update-index', '--no-assume-unchanged', 'assumed.txt');
    repo.git('update-index', '--no-skip-worktree', 'skipped.txt');
    repo.git('update-index', '--no-assume-unchanged', '--no-skip-worktree', 'both.txt');
    assert.equal(runNodeBlock(probe(), repo.dir).stdout.trim(), '(none)',
      'the documented remedy must actually clear the stop');
  });
});

describe('Step 0 pin: which redactor is selected, and when it refuses', () => {
  const made = [];
  after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

  const repoWith = (build) => {
    const { dir, git } = mkrepo();
    made.push(dir);
    build(dir, git);
    return dir;
  };
  const commitRedactor = (dir, git, at = 'scripts') => {
    fs.mkdirSync(join(dir, at), { recursive: true });
    fs.copyFileSync(join(ROOT, 'scripts/security-redact.js'), join(dir, at, 'security-redact.js'));
    git('add', '--', join(at, 'security-redact.js'));
    git('commit', '-qm', 'install redactor');
  };

  test('a tracked, unmodified in-repo copy is pinned with its digest', () => {
    const dir = repoWith((d, git) => commitRedactor(d, git));
    const r = runNodeBlock(pin(), dir);
    assert.equal(r.status, 0, r.stderr);
    const [p, digest] = r.stdout.trim().split('\n');
    assert.ok(p.endsWith('scripts/security-redact.js'), `unexpected path: ${p}`);
    assert.match(digest, /^[0-9a-f]{64}$/, 'the digest is what the scanner will check against');
    assert.equal(digest, createHash('sha256').update(fs.readFileSync(p)).digest('hex'), 'and it is that file');
  });

  test('an untracked in-repo copy is refused — this run may have written it', () => {
    const dir = repoWith((d) => {
      fs.mkdirSync(join(d, 'scripts'), { recursive: true });
      fs.copyFileSync(join(ROOT, 'scripts/security-redact.js'), join(d, 'scripts', 'security-redact.js'));
    });
    const r = runNodeBlock(pin(), dir);
    assert.notEqual(r.status, 0, 'nothing trustworthy to pin');
    assert.match(r.stdout, /\[STOP\] no trusted security-redact\.js to pin/);
  });

  test('CLAUDE_PLUGIN_ROOT pointing INTO the repository gets the same tracked-and-clean check', () => {
    // `claude --plugin-dir .` is a supported local-development invocation, and it makes the "active
    // installation" the repository itself. Naming a path does not make it trusted; its location does.
    const dir = repoWith((d) => {
      fs.mkdirSync(join(d, 'scripts'), { recursive: true });
      fs.writeFileSync(join(d, 'scripts', 'security-redact.js'),
        'require("fs").writeFileSync("IMPOSTOR_RAN", "x");\nmodule.exports = { redact: (t) => t };\n');
    });
    const r = runNodeBlock(pin(), dir, { env: { CLAUDE_PLUGIN_ROOT: dir } });
    assert.equal(fs.existsSync(join(dir, 'IMPOSTOR_RAN')), false, 'and nothing is required to find out');
    assert.notEqual(r.status, 0, 'an untracked candidate is refused however it was named');
    assert.match(r.stdout, /\[STOP\]/);
  });

  test('a TRACKED, unmodified repository-local symlink is still refused', () => {
    // The escape the git checks alone cannot close, which is why `lstat` runs first. Git tracks a
    // symlink as its target path, so a committed link is "tracked and unmodified" forever while the
    // bytes it resolves to live outside the tree and outside version control — the child edits the
    // target, git sees nothing, and classifying by the resolved path would call it "outside the
    // repository" and skip validation entirely.
    const outside = fs.mkdtempSync(join(tmpdir(), 'ci-outside-'));
    made.push(outside);
    fs.writeFileSync(join(outside, 'security-redact.js'),
      'require("fs").writeFileSync("LINKED_RAN", "x");\nmodule.exports = { redact: (t) => t };\n');
    const dir = repoWith((d, git) => {
      fs.mkdirSync(join(d, 'scripts'), { recursive: true });
      fs.symlinkSync(join(outside, 'security-redact.js'), join(d, 'scripts', 'security-redact.js'));
      git('add', '--', 'scripts/security-redact.js');
      git('commit', '-qm', 'commit the link');
    });
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    assert.equal(git('status', '--porcelain', '--', 'scripts/security-redact.js'), '',
      'control: git really does report this link as tracked and unmodified');
    const r = runNodeBlock(pin(), dir);
    assert.equal(fs.existsSync(join(dir, 'LINKED_RAN')), false, 'nothing was required to find out');
    assert.notEqual(r.status, 0, 'a link is never a candidate, however clean git says it is');
    assert.match(r.stdout, /\[STOP\]/);
  });

  for (const layout of [['data', 'sd0x-dev-flow'], ['marketplaces', 'm', 'plugins', 'sd0x-dev-flow'],
    ['cache', 'sd0xdev-marketplace', 'sd0x-dev-flow', '4.5.0']]) {
    test(`a single copy under ${layout.join('/')} is one candidate, not two`, () => {
      // The walk finds the same physical file at two levels in the non-versioned layouts. Counted
      // twice, the exactly-one rule rejected a perfectly unambiguous single installation.
      const dir = repoWith(() => {});
      const home = fs.mkdtempSync(join(tmpdir(), 'ci-home-'));
      made.push(home);
      const p = join(home, '.claude', 'plugins', ...layout, 'scripts');
      fs.mkdirSync(p, { recursive: true });
      fs.copyFileSync(join(ROOT, 'scripts/security-redact.js'), join(p, 'security-redact.js'));
      const r = runNodeBlock(pin(), dir, { home });
      assert.equal(r.status, 0, `one installation is not an ambiguity: ${r.stdout}`);
      assert.match(r.stdout.trim().split('\n')[1], /^[0-9a-f]{64}$/, 'and it is pinned');
    });
  }

  test('two distinct installations with no CLAUDE_PLUGIN_ROOT stop rather than guess', () => {
    const dir = repoWith(() => {});
    const home = fs.mkdtempSync(join(tmpdir(), 'ci-home-'));
    made.push(home);
    for (const v of ['1.0.0', '2.0.0']) {
      const p = join(home, '.claude', 'plugins', 'cache', 'm', 'sd0x-dev-flow', v, 'scripts');
      fs.mkdirSync(p, { recursive: true });
      fs.copyFileSync(join(ROOT, 'scripts/security-redact.js'), join(p, 'security-redact.js'));
    }
    const r = runNodeBlock(pin(), dir, { home });
    assert.notEqual(r.status, 0, 'ambiguity is a stop');
    assert.match(r.stdout, /several plugin installations/, 'and it says which ambiguity it refuses');
  });
});

describe('Step 3b content scan: what it prints, masks and withholds', () => {
  const scan = () => nodeBlocks[2];
  const HIGH = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n';
  const made = [];

  // A real git repository, because the scanner resolves its root with `git rev-parse
  // --show-toplevel` and asks git itself which paths were created.
  const setup = (extra = () => {}) => {
    const { dir, git } = mkrepo();
    made.push(dir);
    fs.mkdirSync(join(dir, 'scripts'), { recursive: true });
    fs.copyFileSync(join(ROOT, 'scripts/security-redact.js'), join(dir, 'scripts', 'security-redact.js'));
    fs.writeFileSync(join(dir, 'plain.txt'), 'hello world\nordinary source\n');
    fs.mkdirSync(join(dir, 'nested', 'deeper'), { recursive: true });
    extra(dir, git);
    return dir;
  };
  const redactorIn = (dir) => join(dir, 'scripts', 'security-redact.js');
  const run = (dir, { cwd = dir, args } = {}) =>
    runNodeBlock(scan(), cwd, { args: args || pinOf(redactorIn(dir)) });
  after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

  test('the pinned redactor is loaded and an ordinary created file is shown', () => {
    const d = setup();
    const r = run(d);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /Cannot find module/, 'the pinned path is absolute and resolvable');
    assert.match(r.stdout, /ordinary source/, 'an ordinary created file is shown to the user');
  });

  test('invoked from a nested directory it still resolves the root and every created path', () => {
    const d = setup((dir) => fs.writeFileSync(join(dir, 'high.txt'), HIGH));
    const r = run(d, { cwd: join(d, 'nested', 'deeper') });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ordinary source/, 'a root-level created file is found from a nested cwd');
    assert.match(r.stdout, /\[WITHHELD secret\] high\.txt/, 'and the secret is still refused');
  });

  test('a high-confidence secret is withheld, and its bytes never reach stdout', () => {
    const d = setup((dir) => fs.writeFileSync(join(dir, 'high.txt'), HIGH));
    const r = run(d);
    assert.match(r.stdout, /\[WITHHELD secret\] high\.txt/, 'the file is named and refused');
    assert.doesNotMatch(r.stdout, /BEGIN RSA PRIVATE KEY/, 'the matched material must never be printed');
    assert.doesNotMatch(r.stdout, /--- high\.txt/,
      'nor a header announcing a file the scan then refuses — redact first, print second');
  });

  test('a medium-confidence secret is masked rather than withheld', () => {
    const d = setup((dir) => fs.writeFileSync(join(dir, 'medium.txt'), 'password = hunter2extra\n'));
    const out = run(d).stdout;
    assert.match(out, /\[REDACTED\]/, 'the value is masked');
    assert.doesNotMatch(out, /hunter2extra/, 'and the raw value is gone');
  });

  test('a symlink is withheld without following it', () => {
    const d = setup((dir) => fs.symlinkSync('/etc/hosts', join(dir, 'link.txt')));
    const out = run(d).stdout;
    assert.match(out, /\[WITHHELD non-regular\] link\.txt \(symlink\)/, 'lstat classifies it as a link');
    assert.doesNotMatch(out, /localhost/, 'readFileSync would have followed it out of the repository');
  });

  test('binary and line-oversized files are withheld by name', () => {
    const d = setup((dir) => {
      fs.writeFileSync(join(dir, 'bin.dat'), Buffer.from([0x61, 0x00, 0x62]));
      fs.writeFileSync(join(dir, 'big.txt'), 'x\n'.repeat(600));
    });
    const out = run(d).stdout;
    assert.match(out, /\[WITHHELD binary\] bin\.dat/, 'a NUL byte is the binary test');
    assert.match(out, /\[WITHHELD oversized\] big\.txt \(601 lines\)/, 'over the line budget');
  });

  test('an ignored file is withheld on status alone, before anything reads it', () => {
    const d = setup((dir) => {
      fs.writeFileSync(join(dir, '.gitignore'), '.env\n');
      fs.writeFileSync(join(dir, '.env'), 'API_TOKEN=abcdefghijklmnop\n');
    });
    const out = run(d).stdout;
    assert.match(out, /\[WITHHELD ignored\] \.env/, '.gitignore is the project saying this is not source');
    assert.doesNotMatch(out, /abcdefghijklmnop/, 'and nothing from it is printed');
  });

  test('a huge file is refused on its size, without being read into memory', () => {
    const d = setup((dir) => {
      const fd = fs.openSync(join(dir, 'huge.bin'), 'w');
      fs.ftruncateSync(fd, 2 * 1024 * 1024 * 1024);
      fs.closeSync(fd);
    });
    const r = run(d);
    assert.equal(r.status, 0, `the scan must survive it: ${r.stderr}`);
    assert.match(r.stdout, /\[WITHHELD oversized\] huge\.bin \(2147483648 bytes\)/,
      'refused on lstat size — the line-count check happens after the read it must avoid');
    assert.doesNotMatch(r.stderr, /ERR_FS_FILE_TOO_LARGE|heap out of memory/, 'the read never happened');
  });

  test('a filename full of shell metacharacters is data, not a command', () => {
    const evil = '$(printf SHELL_INJECTED >&2)`id`;touch INJECTED.txt';
    const d = setup((dir) => fs.writeFileSync(join(dir, evil), 'ordinary content\n'));
    const r = run(d);
    assert.equal(fs.existsSync(join(d, 'INJECTED.txt')), false, 'no command ran from the filename');
    assert.doesNotMatch(r.stderr, /SHELL_INJECTED/, 'nor did a command substitution execute');
    assert.match(r.stdout, /ordinary content/, 'and the file was still scanned and shown as data');
  });

  test('a filename containing a newline survives the NUL-delimited transport', () => {
    const d = setup((dir) => fs.writeFileSync(join(dir, 'two\nlines.txt'), 'newline named\n'));
    const out = run(d).stdout;
    assert.match(out, /newline named/, 'the file is found and read despite the newline in its name');
    assert.match(out, /ordinary source/, 'and the entry after it is not desynchronised');
  });

  test('a secret written into an existing TRACKED file is withheld, diff and all', () => {
    const d = setup((dir, git) => {
      fs.writeFileSync(join(dir, 'config.js'), 'module.exports = { host: "localhost" };\n');
      git('add', '--', 'config.js');
      git('commit', '-qm', 'add config');
      fs.writeFileSync(join(dir, 'config.js'),
        'module.exports = { host: "localhost", key: "-----BEGIN RSA PRIVATE KEY-----" };\n');
      git('add', '--', 'config.js');
    });
    const r = run(d);
    assert.doesNotMatch(r.stdout, /BEGIN RSA PRIVATE KEY/, 'the staged secret must not be printed');
    assert.match(r.stdout, /\[WITHHELD secret-in-diff\] config\.js/, 'the file is named and refused');
  });

  test('a medium-confidence value in a tracked diff is masked rather than withheld', () => {
    const d = setup((dir, git) => {
      fs.writeFileSync(join(dir, 'settings.js'), 'const a = 1;\n');
      git('add', '--', 'settings.js');
      git('commit', '-qm', 'add settings');
      fs.writeFileSync(join(dir, 'settings.js'), 'const a = 1;\nconst API_TOKEN = "abcdefghijklmnop";\n');
    });
    const out = run(d).stdout;
    assert.match(out, /--- diff settings\.js/, 'the diff is shown');
    assert.doesNotMatch(out, /abcdefghijklmnop/, 'with the value masked');
    assert.match(out, /\[REDACTED\]/, 'and the mask is visible in place of it');
  });

  test('a redactor modified after the pin is refused, even where git cannot see the change', () => {
    // The route no post-dispatch predicate can close: a child sets `assume-unchanged` on a tracked
    // file and overwrites it, so `git status` reports clean and `ls-files --error-unmatch` succeeds.
    // The digest does not consult git, so it notices anyway.
    const d = setup();
    const pinned = pinOf(redactorIn(d));
    const git = (...a) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8' });
    git('add', '--', 'scripts/security-redact.js');
    git('commit', '-qm', 'track redactor');
    git('update-index', '--assume-unchanged', 'scripts/security-redact.js');
    fs.writeFileSync(redactorIn(d),
      'require("fs").writeFileSync("TAMPERED_RAN", "x");\nmodule.exports = { redact: (t) => t };\n');
    assert.equal(git('status', '--porcelain', '--', 'scripts/security-redact.js'), '',
      'control: git really does report this tampering as a clean tree');
    const r = runNodeBlock(scan(), d, { args: pinned });
    assert.equal(fs.existsSync(join(d, 'TAMPERED_RAN')), false, 'the tampered module was never required');
    assert.match(r.stdout, /\[STOP\] the redactor changed since Step 0 pinned it/, 'the digest caught it');
    assert.doesNotMatch(r.stdout, /ordinary source/, 'and nothing is printed unscanned');
  });

  test('a bad or missing digest argument stops the scan', () => {
    // Bypasses runNodeBlock's slot substitution on purpose: these are malformed invocations, and the
    // point is what the command does when the operator gets the arguments wrong.
    const d = setup();
    const body = scan().script;
    for (const tail of ['', ` -- '${redactorIn(d)}'`, ` -- '${redactorIn(d)}' 'not-a-digest'`]) {
      const r = spawnSync('/bin/sh', ['-c', body + tail], { cwd: d, encoding: 'utf8' });
      assert.notEqual(r.status, 0, `must refuse: ${tail || '(no arguments)'}`);
      assert.match(r.stdout, /\[STOP\] this command takes the redactor path and its 64-hex digest/);
    }
  });

  test('the documented invocation survives a path with a space and an apostrophe', () => {
    // An ordinary installation path. Unquoted, the space split it into two arguments and the second
    // half was read as the digest, stopping every confirmation this workflow exists to produce.
    const d = setup();
    const awkward = join(d, "My Project's scripts");
    fs.mkdirSync(awkward, { recursive: true });
    const target = join(awkward, 'security-redact.js');
    fs.copyFileSync(join(ROOT, 'scripts/security-redact.js'), target);
    const r = runNodeBlock(scan(), d, { args: pinOf(target) });
    assert.equal(r.status, 0, `the documented construction must handle it: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /ordinary source/, 'and the scan runs normally');
  });

  test('the pinned path is opened exactly once — the verified buffer is what runs', () => {
    // The check/use window cannot be closed by ordering checks around a second open, and a race is
    // not deterministically testable from outside the process. What IS checkable, exactly, is the
    // structural property that removes the window: the command reads the path once and compiles
    // THAT buffer. `require(pinnedPath)` would be a second open of a mutable pathname.
    // Comments stripped first: the block explains WHY `require(pinnedPath)` is wrong, and a check
    // that matched its own explanation would be red on the correct code and green on nothing.
    const body = scan().script.split('\n').map((l) => l.replace(/\s*\/\/.*$/, '')).join('\n');
    assert.doesNotMatch(body, /require\(pinnedPath\)/,
      'requiring the pathname reopens it after the digest was computed on different bytes');
    assert.match(body, /const src = fs\.readFileSync\(pinnedPath\)/, 'one read');
    assert.match(body, /createHash\("sha256"\)\.update\(src\)/, 'hashed from that buffer');
    assert.match(body, /mod\._compile\(src\.toString\("utf8"\), pinnedPath\)/, 'and executed from it');
    assert.equal((body.match(/readFileSync\(pinnedPath\)/g) || []).length, 1,
      'and the pinned path is read exactly once');
  });

  test('a redactor swapped before execution cannot be executed', () => {
    // The check/use window: the digest is computed on one read, and `require(path)` would open the
    // pathname a second time. Simulated deterministically by pinning the digest of one file and
    // leaving different bytes at the path — if the command re-read the path it would compile them.
    const d = setup();
    const [p, digest] = pinOf(redactorIn(d));
    fs.writeFileSync(p, 'require("fs").writeFileSync("SWAPPED_RAN", "x");\nmodule.exports = { redact: (t) => t };\n');
    const r = runNodeBlock(scan(), d, { args: [p, digest] });
    assert.equal(fs.existsSync(join(d, 'SWAPPED_RAN')), false, 'the swapped module was never compiled');
    assert.match(r.stdout, /\[STOP\] the redactor changed since Step 0 pinned it/);
    assert.doesNotMatch(r.stdout, /ordinary source/, 'and nothing is printed');
  });

  test('a stale redactor with the value-position bug is refused by the capability probe', () => {
    // The digest proves the bytes are the pinned ones; it cannot prove the pinned ones work. An
    // older installation is unmodified and still gets the positional cases wrong.
    const d = setup();
    fs.writeFileSync(redactorIn(d), `
const MEDIUM = [
  { re: /\\b[A-Za-z0-9_-]*(?:password|passwd|pwd)['"\`]?\\s*[:=]\\s*['"\`]?([^\\s'"\`,;}]+)/gi, group: 1 },
  { re: /\\b[A-Za-z0-9_-]*(?:token|api[_-]?key|secret)['"\`]?\\s*[:=]\\s*['"\`]?([^\\s'"\`,;}]+)/gi, group: 1 },
];
function redact(text) {
  let out = text;
  for (const { re, group } of MEDIUM) {
    out = out.replace(re, (match, ...args) => {
      const captured = args[group - 1];
      if (!captured) return match;
      return match.replace(captured, '[REDACTED]');   // the defect: by value, not by position
    });
  }
  return out;
}
module.exports = { redact };
`);
    const r = runNodeBlock(scan(), d, { args: pinOf(redactorIn(d)) });
    assert.notEqual(r.status, 0, 'a redactor that fails its probe stops the scan');
    assert.match(r.stdout, /\[STOP\].*capability probe/, 'and says why');
    assert.doesNotMatch(r.stdout, /ordinary source/, 'nothing is printed by an untrusted scan');
  });
});
