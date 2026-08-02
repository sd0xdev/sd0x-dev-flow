const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, chmodSync, symlinkSync } = require("node:fs");
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '../..');
const script = resolve(root, 'skills/create-pr/scripts/sanitize-pr-content.sh');
const runner = resolve(root, 'scripts/run-skill.sh');
const guard = resolve(root, 'scripts/commit-msg-guard.sh');

/**
 * Run the script on content written to a temp file.
 *
 * `pluginRoot` selects a crafted plugin tree — and it does so the way the
 * script itself resolves the policy: by running the COPY of the script that
 * lives inside that tree. Injecting an environment variable would not be a
 * fixture, it would be the defect: a variable that chooses the pattern source
 * is, at runtime, indistinguishable from an attack, and the earlier version of
 * this harness depended on exactly the hole it claimed to test for.
 */
function run(mode, content, { pluginRoot, keepFile, brokenUtility, brokenStatus = 7, extraEnv } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-pr-'));
  try {
    const file = join(dir, 'content.md');
    writeFileSync(file, content);
    const env = { ...process.env, ...extraEnv };
    const target = pluginRoot === undefined
      ? script
      : join(pluginRoot, 'skills/create-pr/scripts/sanitize-pr-content.sh');
    let runTarget = target;
    let mutatedRoot;
    if (brokenUtility !== undefined) {
      // Shadow one utility with a failing stub, to exercise the path where a
      // helper — not grep, not the caller's input — is what goes wrong.
      //
      // The stub CANNOT be injected through the environment any more: the script
      // pins PATH to the system directories precisely so a caller cannot choose
      // which `grep` or `sed` decides the verdict. That pin is the security
      // property, so the test must not weaken it to reach the code underneath.
      // Instead the stub directory is prepended to the pinned list inside a
      // complete copy of the tree — still a fixed list, still not caller-chosen,
      // but one this harness controls. `realRoot` builds the whole tree because
      // policy resolution walks `<script>/../../..`, and it asserts the
      // substitution applied: an edit that matched nothing looks exactly like a
      // guard that held.
      const binDir = join(dir, 'bin');
      mkdirSync(binDir);
      writeFileSync(join(binDir, brokenUtility), `#!/bin/sh\nexit ${brokenStatus}\n`);
      require('node:fs').chmodSync(join(binDir, brokenUtility), 0o755);
      mutatedRoot = realRoot((src) =>
        src.replace(
          "PATH='/usr/bin:/bin:/usr/sbin:/sbin'",
          `PATH='${binDir}:/usr/bin:/bin:/usr/sbin:/sbin'`
        ));
      runTarget = join(mutatedRoot, 'skills/create-pr/scripts/sanitize-pr-content.sh');
    }
    const r = spawnSync('bash', [runTarget, mode, file], { encoding: 'utf8', env });
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      file: keepFile ? readFileSync(file, 'utf8') : undefined,
      leftovers: readdirSync(dir).filter((f) => f !== 'content.md' && f !== 'bin'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A plugin root whose commit-msg-guard.sh declares exactly these patterns —
 * with the script copied into its real position inside the tree, because
 * resolution is `<script>/../../..` and nothing else.
 */
function fakeRoot(patternLines) {
  const root = mkdtempSync(join(tmpdir(), 'sanitize-root-'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts/commit-msg-guard.sh'),
    `PATTERNS=(\n${patternLines}\n)\n`);
  plantScript(root);
  return root;
}

/** Put the script where its own `../../..` resolution expects it. */
function plantScript(root) {
  const scriptDir = join(root, 'skills/create-pr/scripts');
  mkdirSync(scriptDir, { recursive: true });
  writeFileSync(join(scriptDir, 'sanitize-pr-content.sh'), readFileSync(script));
  return root;
}

// The three real trailers this policy exists to stop, one per canonical pattern.
/**
 * Run the sanitizer with hand-written stub utilities in front of its search path.
 *
 * The script pins PATH so a caller cannot choose which `grep` or `sed` decides
 * the verdict — that pin IS the security property, so a test must not reach past
 * it with an environment variable. What this does instead is build a complete
 * tree (policy resolution walks `<script>/../../..`) and rewrite the pinned list
 * to put a harness-owned directory first: still fixed, still not caller-supplied,
 * but ours. `realRoot` asserts the substitution applied, because a rewrite that
 * matched nothing is indistinguishable from a guard that held.
 */
function withStubbedPath(stubs, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-stub-'));
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(binDir, name), body);
      chmodSync(join(binDir, name), 0o755);
    }
    const stubRoot = realRoot((src) =>
      src.replace(
        "PATH='/usr/bin:/bin:/usr/sbin:/sbin'",
        `PATH='${binDir}:/usr/bin:/bin:/usr/sbin:/sbin'`
      ));
    try {
      return fn({
        script: join(stubRoot, 'skills/create-pr/scripts/sanitize-pr-content.sh'),
        dir,
      });
    } finally {
      rmSync(stubRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CO_AUTHOR = 'Co-Authored-By: Claude <noreply@anthropic.com>';
const ROBOT = '🤖 Generated with Claude Code';
const GENERATED = 'Generated by GPT-4';

test('title mode accepts a title carrying no attribution', () => {
  const r = run('title', 'feat: [PROJ-42] Add widget endpoint\n');
  assert.equal(r.status, 0, 'a clean title must pass');
  assert.equal(r.stderr, '', 'a clean title must produce no diagnostics');
});

test('title mode rejects each canonical attribution form with exit 3', () => {
  for (const hostile of [CO_AUTHOR, ROBOT, GENERATED]) {
    const r = run('title', `feat: ${hostile}\n`);
    assert.equal(r.status, 3, `title mode must fail on: ${hostile}`);
    assert.match(r.stderr, /\[AI_DETECTED\]/, 'the offending line must be reported');
  }
});

test('title mode never rewrites — the caller regenerates or aborts', () => {
  const r = run('title', `feat: ${ROBOT}\n`);
  assert.equal(r.stdout, '', 'title mode must not emit a "fixed" title');
});

test('body mode strips only the offending lines and logs each removal', () => {
  const body = ['## Summary', '', 'Adds the widget.', CO_AUTHOR, '', '## Test plan', '', '- unit'].join('\n');
  const r = run('body', `${body}\n`);
  assert.equal(r.status, 0, 'body mode succeeds — stripping is not a failure');
  assert.doesNotMatch(r.stdout, /Co-Authored-By/, 'the attribution line must be gone');
  assert.match(r.stdout, /Adds the widget\./, 'innocent content must survive');
  assert.match(r.stdout, /## Test plan/, 'structure must survive');
  assert.match(r.stderr, /\[AI_STRIPPED\] line 4 matched pattern \d+/, 'each removal must be logged by location');
});

test('body mode reports every removed line, attributed to the pattern that fired', () => {
  // Matching is per pattern, so one line can be reported twice — `🤖 Generated
  // with Claude Code` trips both the robot-tag and the generated-by pattern.
  // That is deliberate: attribution is what makes an invalid pattern traceable
  // to itself instead of silently disabling the whole set.
  const r = run('body', ['## Summary', CO_AUTHOR, ROBOT, GENERATED, 'Real content.'].join('\n') + '\n');
  const stripped = r.stderr.split('\n').filter((l) => l.startsWith('[AI_STRIPPED]'));
  const lines = new Set(stripped.map((l) => l.match(/line (\d+)/)[1]));
  assert.deepEqual([...lines].sort(), ['2', '3', '4'], 'every hostile line must be reported');
  assert.ok(stripped.length >= 3, 'at least one report per removed line');
  assert.equal(r.stdout.trim().split('\n').length, 2, 'only the two innocent lines survive');
  assert.match(r.stdout, /Real content\./, 'unrelated content must survive');
});

test('body mode preserves template structure when everything was stripped', () => {
  const r = run('body', `${CO_AUTHOR}\n${GENERATED}\n`);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /## Summary/, 'an emptied body must keep its headers');
  assert.match(r.stdout, /## Test plan/, 'an emptied body must keep its headers');
  assert.doesNotMatch(r.stdout, /Claude|GPT/, 'nothing hostile may survive');
});

test('scan mode reports published leaks with exit 4, distinct from a title failure', () => {
  const clean = run('scan', '## Summary\n\nAll good.\n');
  assert.equal(clean.status, 0, 'clean published content must pass');
  const leaked = run('scan', `## Summary\n${CO_AUTHOR}\n`);
  assert.equal(leaked.status, 4, 'a published leak must be distinguishable from a pre-publish title failure');
  assert.match(leaked.stderr, /\[AI_DETECTED\]/);
});

test('detection is case-insensitive, matching the canonical grep -Ei contract', () => {
  const r = run('scan', 'co-authored-by: claude <noreply@anthropic.com>\n');
  assert.equal(r.status, 4, 'a lowercased trailer is the same trailer');
});

test('bare "AI" inside ordinary words is not an attribution', () => {
  // The canonical patterns bound `AI` with \b precisely so "maintainer" and
  // "domain" do not trip the guard. A false positive here would strip real
  // content out of every body that mentions a maintainer.
  const body = '## Summary\n\nThe maintainer updated the domain and explained the detailed plan.\n';
  const r = run('body', body);
  assert.equal(r.stderr, '', 'no line should have been stripped');
  assert.match(r.stdout, /maintainer updated the domain/, 'ordinary prose must survive intact');
});

test('unbounded GPT still catches ChatGPT and GPT4', () => {
  for (const variant of ['Generated by ChatGPT', 'Generated with GPT4']) {
    const r = run('scan', `${variant}\n`);
    assert.equal(r.status, 4, `must detect: ${variant}`);
  }
});

test('an empty body is passed through as template structure, not as an error', () => {
  const r = run('body', '');
  assert.equal(r.status, 0, 'an empty body is not a failure');
  assert.match(r.stdout, /## Summary/, 'an empty body still yields the template');
});

test('a missing content file fails with exit 2 rather than passing silently', () => {
  const r = spawnSync('bash', [script, 'title', join(tmpdir(), 'definitely-not-here-93f1.md')], { encoding: 'utf8' });
  assert.equal(r.status, 2, 'a missing file must be a usage error, not a pass');
  assert.match(r.stderr, /file not found/);
});

test('an unknown mode fails with exit 2 rather than defaulting to something', () => {
  const r = run('sanitise', 'anything\n');
  assert.equal(r.status, 2, 'a typo in the mode must not silently do nothing');
  assert.match(r.stderr, /unknown mode/);
});

test('missing arguments fail rather than operating on an empty path', () => {
  const r = spawnSync('bash', [script], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'no arguments must be a usage error');
});

test('a pattern source with no patterns refuses to pass content unchecked', () => {
  // Fail closed. Reading zero patterns and then reporting "clean" is the one
  // failure mode that would silently disable the whole policy.
  const root = mkdtempSync(join(tmpdir(), 'sanitize-root-'));
  try {
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'scripts/commit-msg-guard.sh'), '#!/bin/sh\necho hi\n');
    plantScript(root);
    const r = run('scan', `${CO_AUTHOR}\n`, { pluginRoot: root });
    assert.equal(r.status, 2, 'an unusable pattern source must abort, not pass');
    assert.match(r.stderr, /refusing to pass content unchecked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a pattern block that only partly parses refuses to enforce a subset', () => {
  // The dangerous middle ground between "all three patterns" and "none": the
  // guard declares three, the parser recognises two, and the caller cannot tell
  // that a third of the policy stopped applying.
  // Four declared, three parseable — above the minimum-count floor, so the
  // floor check cannot catch it. Which of the two remaining guards fires is
  // deliberately not asserted: the entry-shape check (added for the
  // validly-quoted case below) rejects this fixture first, and the
  // declared-vs-parsed count behind it is defence in depth — the two derive
  // from separate string operations (a case glob and a sed substitution) that
  // could drift apart. What must hold either way is that a block this parser
  // cannot fully read never yields a verdict.
  const root = fakeRoot(
    "  'Co-Authored-By:.*Claude'\n  'Generated (by|with).*Claude'\n"
    + "  '\ud83e\udd16.*Claude'\n  'unterminated"
  );
  try {
    const r = run('scan', `${CO_AUTHOR}\n`, { pluginRoot: root });
    assert.equal(r.status, 2, 'a partial parse must abort rather than enforce what it managed to read');
    assert.match(r.stderr, /refusing to enforce (a subset|a policy it cannot fully read)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failing helper utility reports 2, not the utility’s own status', () => {
  // The exit protocol is the caller's whole interface: 0 clean, 3 title
  // rejected, 4 published leak, everything else 2 = fail closed. A raw `awk`
  // or `cat` status escaping through `set -e` would break that — 1 and 2 are
  // both statuses this script already assigns a meaning to, so a caller
  // branching on them would act on a verdict that was never reached.
  // The stripping branch and the pass-through branch use different utilities,
  // so each needs the content that reaches it: `awk` only runs when there is
  // something to drop, `cat` only when there is not.
  const hostile = `## Summary\n\nReal content.\n${CO_AUTHOR}\n`;
  const clean = '## Summary\n\nReal content.\n';
  for (const [mode, utility, content] of [
    ['body', 'awk', hostile],
    ['body', 'cat', clean],
    ['body-inplace', 'mv', hostile],
  ]) {
    const r = run(mode, content, { brokenUtility: utility });
    assert.equal(r.status, 2, `${mode}: a failing ${utility} must fail closed as 2`);
    assert.match(r.stderr, /^sanitize-pr-content: /m,
      `${mode}: the failure must be attributed, not silent`);
  }
});

test('a pattern extractor that produces output and then fails is not trusted', () => {
  // The hardest shape of helper failure, and the one output validation cannot
  // catch: `sed` prints a full set of *weakened* patterns and then exits
  // nonzero. Every count check downstream is satisfied — three entries,
  // matching the declared count — so the only thing that can reject it is the
  // exit status, and a `while … done < <(cmd)` discards exactly that.
  // Delegates the block-range call to the real sed; sabotages only the
  // substitution that extracts the individual patterns.
  const stubSed = [
    '#!/bin/sh',
    'for a in "$@"; do',
    '  case "$a" in',
    "    s/*) printf '%s\\n' 'nothing-matches-aaa' 'nothing-matches-bbb' 'nothing-matches-ccc'; exit 7 ;;",
    '  esac',
    'done',
    'exec /usr/bin/sed "$@"',
  ].join('\n');
  withStubbedPath({ sed: stubSed }, ({ script: stubbed, dir }) => {
    const file = join(dir, 'content.md');
    writeFileSync(file, `${CO_AUTHOR}\n`);
    const r = spawnSync('bash', [stubbed, 'scan', file], { encoding: 'utf8' });
    assert.equal(r.status, 2, 'a failed extraction must fail closed, never report the content clean');
    assert.notEqual(r.status, 0, 'the weakened pattern set must not be enforced as if it were the policy');
    assert.match(r.stderr, /refusing to enforce a policy it could not read/);
  });
});

test('the sanitizer itself ships no heredoc, so the ban is as wide as it is stated', () => {
  // `/create-pr` states the prohibition without qualification, and its document
  // sweep only reads the two Markdown files — so a heredoc in this script would
  // sit outside the check while making the stated scope false. Process
  // substitution replaced the one that was here.
  const source = readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /<<-?\s*['"]?\w+/, 'no heredoc of any delimiter form');
});

test('inherited shell tracing cannot turn the redacted diagnostic back into a disclosure', () => {
  // report() withholds the matching line because it can carry a token. That
  // redaction is worth nothing if the shell itself echoes every expansion:
  // with xtrace inherited through an exported SHELLOPTS, bash writes the whole
  // `out=...` assignment — the matched lines, verbatim — to the same stderr.
  // The caller does not have to opt into tracing for this to happen; anything
  // upstream that exported it is enough.
  const secret = 'ghp_EXAMPLEONLYnotarealtoken00000000';
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-trace-'));
  try {
    const file = join(dir, 'content.md');
    writeFileSync(file, `## Summary\n\nReal content.\nGenerated by GPT-4; token=${secret}\n`);
    for (const mode of ['scan', 'body']) {
      const r = spawnSync('bash', [script, mode, file], {
        encoding: 'utf8',
        env: { ...process.env, SHELLOPTS: 'xtrace', BASH_XTRACEFD: '2' },
      });
      assert.doesNotMatch(r.stderr, new RegExp(secret),
        `${mode}: tracing must not disclose the matched line`);
      assert.doesNotMatch(r.stdout, new RegExp(secret),
        `${mode}: the token must not reach stdout either`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing emptiness test never replaces a real body with the skeleton', () => {
  // The check for "did stripping remove everything?" pipes into `tr`. Hidden
  // inside a command substitution its failure produces no output, which reads
  // as "empty" — so a broken `tr` would report success while replacing a
  // perfectly good body with the bare Summary/Test plan headers, and in
  // body-inplace that skeleton is what overwrites the file.
  const r = run('body-inplace', '## Summary\n\nReal content worth keeping.\n',
    { brokenUtility: 'tr', keepFile: true });
  assert.equal(r.status, 2, 'a failing emptiness test must fail closed, not succeed');
  assert.match(r.file, /Real content worth keeping\./,
    'the original body must survive a failure that reached no verdict');
});

test('a validly-quoted entry the parser does not recognise aborts instead of being skipped', () => {
  // The subtler half of the same failure. `"double quoted"` and `$'ANSI-C'` are
  // legal bash array elements, so a future guard entry written that way really
  // would be enforced by the hook — but this parser only recognises the
  // single-quoted form. Counting *recognised* lines instead of *all* lines
  // would make parsed and declared agree while that pattern silently stopped
  // applying here, which is the fail-open the entry count exists to prevent.
  for (const [label, entry] of [
    ['double-quoted', '  "Co-Authored-By:.*Copilot"'],
    ['ANSI-C quoted', "  $'Generated \\x62y.*Copilot'"],
  ]) {
    const root = fakeRoot(
      "  'Co-Authored-By:.*Claude'\n  'Generated (by|with).*Claude'\n"
      + `  '🤖.*Claude'\n${entry}`
    );
    try {
      const r = run('scan', `${CO_AUTHOR}\n`, { pluginRoot: root });
      assert.equal(r.status, 2, `${label}: an unrecognised entry must abort, not be skipped`);
      assert.match(r.stderr, /refusing to enforce a policy it cannot fully read/,
        `${label}: the diagnostic must say the policy was not fully read`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('no environment variable can redirect the policy to a weaker source', () => {
  // At runtime a variable whose only effect is to swap the enforced policy for
  // a weaker one is indistinguishable from an attack, and the caller cannot
  // tell it happened — the script reports "clean" exactly as it would for
  // genuinely clean content.
  //
  // `PLUGIN_ROOT` is first in the list because it is the one that DID work:
  // the script read `${PLUGIN_ROOT:-…}`, and this suite's own fixtures used
  // that to inject guards — so the test asserted the property while depending
  // on its violation. Asserting only on names the script never reads is a test
  // that cannot fail; the real name has to be in here.
  const benign = fakeRoot("  'nothing-matches-this-aaa'\n  'nothing-matches-this-bbb'\n  'nothing-matches-this-ccc'");
  try {
    for (const name of ['PLUGIN_ROOT', 'AI_PATTERN_SOURCE', 'GUARD', 'PATTERN_SOURCE']) {
      const dir = mkdtempSync(join(tmpdir(), 'sanitize-env-'));
      try {
        const file = join(dir, 'content.md');
        writeFileSync(file, `${CO_AUTHOR}\n`);
        const r = spawnSync('bash', [script, 'scan', file], {
          encoding: 'utf8',
          // PLUGIN_ROOT takes the tree; the rest take a direct path to the
          // guard — whichever shape that variable would have to have to work.
          env: {
            ...process.env,
            [name]: name === 'PLUGIN_ROOT' ? benign : join(benign, 'scripts/commit-msg-guard.sh'),
          },
        });
        assert.equal(r.status, 4, `${name} must not be able to disarm the scan`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(benign, { recursive: true, force: true });
  }
});

test('a pattern grep cannot compile aborts instead of reporting content clean', () => {
  // grep exits 2 for an invalid ERE, an unreadable input or an I/O error. The
  // original implementation collapsed 2 into 1 ("no match"), so a broken
  // pattern set reported every hostile body as clean — fail-open, in the one
  // component whose entire job is to fail closed.
  const root = fakeRoot("  'Co-Authored-By:.*Claude'\n  'a['\n  'Generated (by|with).*Claude'");
  try {
    for (const mode of ['title', 'scan', 'body', 'body-inplace']) {
      const r = run(mode, '## Summary\n\nEntirely innocent content.\n', { pluginRoot: root });
      assert.equal(r.status, 2, `${mode} must fail closed when a pattern cannot be evaluated`);
      assert.match(r.stderr, /refusing to (report content as clean|emit a body reported as clean)/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the policy source cannot be chosen by how the script is invoked', () => {
  // `$0` is the path the CALLER used, and bash does not resolve symlinks in it.
  // So "resolved from the script's own location" is only true once the link
  // chain is followed: without that, a symlink into a crafted tree — or simply
  // invoking it by a relative path from inside one — picks the guard, which is
  // the same total bypass as the environment variable, one step removed.
  const benign = fakeRoot("  'never-matches-aaa'\n  'never-matches-bbb'\n  'never-matches-ccc'");
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-path-'));
  try {
    const file = join(dir, 'content.md');
    writeFileSync(file, `${CO_AUTHOR}\n`);
    // Replace the planted COPY with a symlink to the real script: same tree,
    // same benign guard beside it, but now the file itself lives elsewhere.
    const planted = join(benign, 'skills/create-pr/scripts/sanitize-pr-content.sh');
    rmSync(planted);
    symlinkSync(script, planted);

    const viaLink = spawnSync('bash', [planted, 'scan', file], { encoding: 'utf8' });
    assert.equal(viaLink.status, 4, 'a symlink must not select a weaker policy source');

    const viaRelative = spawnSync('bash', ['sanitize-pr-content.sh', 'scan', file], {
      cwd: join(benign, 'skills/create-pr/scripts'),
      encoding: 'utf8',
    });
    assert.equal(viaRelative.status, 4, 'a relative $0 must not select a weaker policy source');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(benign, { recursive: true, force: true });
  }
});

test('a malformed grep answer is caught however much of it there is', () => {
  // The check this replaced was `printf … | grep -Eqv '^[0-9]+:' && die`.
  // `grep -q` exits at its first match, `printf` then takes EPIPE, and under
  // `pipefail` the pipeline reports printf's status — so the `&&` never fired
  // once grep's output passed the pipe buffer. Small inputs looked guarded;
  // large ones were not, which is the worst possible split.
  // A grep that prefixes the filename — a real BSD-grep behaviour under
  // GREP_OPTIONS=-H — so every output line starts with a path, not a number.
  const stubGrep = [
    '#!/bin/sh',
    'for a in "$@"; do case "$a" in -*) ;; *) f="$a" ;; esac; done',
    'case "$f" in *content.md) exec /usr/bin/grep -H "$@" ;; esac',
    'exec /usr/bin/grep "$@"',
  ].join('\n');
  withStubbedPath({ grep: stubGrep }, ({ script: stubbed, dir }) => {
    const file = join(dir, 'content.md');
    // Well past a 64 KB pipe buffer once each line is prefixed with the path.
    writeFileSync(file, `${CO_AUTHOR}\n`.repeat(200000));
    const r = spawnSync('bash', [stubbed, 'body', file], { encoding: 'utf8' });
    assert.equal(r.status, 2, 'a malformed answer must fail closed at any size');
    assert.match(r.stderr, /unparseable format/);
    assert.doesNotMatch(r.stdout, /Co-Authored-By/, 'nothing may be emitted as a sanitized body');
  });
});

test('two patterns declared on one line are unparseable, not one mangled pattern', () => {
  // `  'A' 'B'` is a legal bash array line declaring TWO elements, and it
  // satisfies every check the parser had: the shape matches (starts `  '`,
  // ends `'`), ENTRIES counts it once, and the extraction yields the single
  // regex `A' 'B` — which matches nothing. Parsed and declared then agree
  // while both real patterns have silently stopped being enforced. The floor
  // check cannot see it either: the count is still ≥ 3.
  const root = fakeRoot(
    "  'Co-Authored-By:.*Claude' 'Generated (by|with).*GPT'\n"
    + "  'never-matches-aaa'\n  'never-matches-bbb'"
  );
  try {
    const r = run('scan', `${CO_AUTHOR}\n`, { pluginRoot: root });
    assert.equal(r.status, 2, 'a line declaring two entries must abort, never enforce one mangled regex');
    assert.match(r.stderr, /refusing to enforce a policy it cannot fully read/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a NUL byte in the body does not turn stripping into a no-op', () => {
  // Without `grep -a`, a single NUL anywhere in the file changes grep's answer
  // from `<n>:<line>` to `Binary file <path> matches`. The location parse then
  // yields `Binary`, awk's skip set gets a key matching no FNR, and the body is
  // emitted UNCHANGED — while the log says [AI_STRIPPED] and the exit code says
  // 0. It is the removal modes that fail, and those are the ones whose output
  // `gh pr edit --body-file` publishes.
  const content = `## Summary\n\nAdds a widget.\n${CO_AUTHOR}\n\u0000\n`;
  const r = run('body-inplace', content, { keepFile: true });
  assert.equal(r.status, 0, `body-inplace should succeed:\n${r.stderr}`);
  assert.ok(!r.file.includes(CO_AUTHOR), 'the trailer must actually be gone from the file, not just reported');
  assert.match(r.stderr, /\[AI_STRIPPED\] line 4 /, 'the diagnostic must carry a real line number');
  assert.doesNotMatch(r.stderr, /Binary file|content\.md/, 'a diagnostic must never print a path or grep noise');

  // And if grep answers in a shape this parser cannot use at all, that is an
  // abort — not a verdict derived from a token that is not a line number.
  const stubGrep = [
    '#!/bin/sh',
    '# Answer "matched" in the binary-file shape, whatever the flags say.',
    'for a in "$@"; do case "$a" in -*) ;; *) f="$a" ;; esac; done',
    'case "$f" in *content.md) printf "Binary file %s matches\\n" "$f"; exit 0 ;; esac',
    'exec /usr/bin/grep "$@"',
  ].join('\n');
  withStubbedPath({ grep: stubGrep }, ({ script: stubbed, dir }) => {
    const file = join(dir, 'content.md');
    writeFileSync(file, `${CO_AUTHOR}\n`);
    const r2 = spawnSync('bash', [stubbed, 'body-inplace', file], { encoding: 'utf8' });
    assert.equal(r2.status, 2, 'an unparseable grep answer must fail closed');
    assert.match(r2.stderr, /unparseable format/);
    assert.doesNotMatch(r2.stderr, /content\.md/, 'the unparseable token may be a path — do not echo it');
  });
});

test('a body byte invalid in the caller locale does not abort the run', () => {
  // The emptiness test pipes the body through `tr`. In a UTF-8 locale a latin-1
  // byte makes `tr` exit with "Illegal byte sequence", which `die` turns into a
  // /create-pr abort — fail-closed, but on a body the skill is otherwise happy
  // with. Running that test under LC_ALL=C treats the byte as a byte.
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-locale-'));
  try {
    const file = join(dir, 'content.md');
    writeFileSync(file, Buffer.concat([
      Buffer.from('## Summary\n\nCaf'),
      Buffer.from([0xe9]),                       // latin-1 'é', invalid UTF-8
      Buffer.from('\n'),
    ]));
    const r = spawnSync('bash', [script, 'body', file], {
      encoding: 'latin1',
      env: { ...process.env, LC_ALL: 'en_US.UTF-8' },
    });
    assert.equal(r.status, 0, `an odd byte must not abort the run:\n${r.stderr}`);
    assert.match(r.stdout, /Caf/, 'the body must be emitted, not replaced by the skeleton');
    assert.doesNotMatch(r.stderr, /Illegal byte sequence|emptiness/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing pattern source aborts instead of falling back to no policy', () => {
  const root = plantScript(mkdtempSync(join(tmpdir(), 'sanitize-root-')));
  try {
    const r = run('scan', `${CO_AUTHOR}\n`, { pluginRoot: root });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /canonical pattern source not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostics never echo the matching line, which may carry a secret', () => {
  // rules/security.md Anchor: never log tokens. A PR body is attacker-influenced
  // text, and an AI trailer is exactly the kind of line a credential gets
  // appended to. Reporting the line number locates it without copying it into
  // the session log, the terminal scrollback, or a CI transcript.
  const secret = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const body = `## Summary\n\nReal content.\nGenerated by GPT-4; token=${secret}\n`;
  for (const mode of ['body', 'body-inplace', 'scan']) {
    const r = run(mode, body);
    assert.doesNotMatch(r.stderr, /ghp_/, `${mode} must not log the credential`);
    assert.ok(!r.stderr.includes(secret), `${mode} must not log the secret verbatim`);
    assert.doesNotMatch(r.stdout, /ghp_/, `${mode} must not emit the credential on stdout either`);
    assert.match(r.stderr, /line 4 matched pattern \d+/, `${mode} must still say where the match was`);
  }
});

test('body-inplace replaces the file and leaves no temp file behind', () => {
  // `sanitizer body <file> > <file>` truncates the input before it is read, so
  // the documented workflow needs a mode that persists the result itself.
  const r = run('body-inplace', `## Summary\n\nAdds the widget.\n${CO_AUTHOR}\n`, { keepFile: true });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.file, /Co-Authored-By/, 'the file itself must have been sanitized');
  assert.match(r.file, /Adds the widget\./, 'innocent content must survive in the file');
  assert.equal(r.stdout, '', 'in-place mode writes the file, not stdout');
  assert.deepEqual(r.leftovers, [], 'no .sanitized temp file may survive');
});

test('body-inplace leaves a clean file byte-identical in content', () => {
  const original = '## Summary\n\nNothing to strip here.\n';
  const r = run('body-inplace', original, { keepFile: true });
  assert.equal(r.status, 0, 'a clean body is not a failure');
  assert.equal(r.file, original, 'a clean body must survive unchanged');
  assert.equal(r.stderr, '', 'nothing was stripped, so nothing is reported');
});

test('the patterns come from commit-msg-guard.sh rather than being duplicated', () => {
  // Two sources of the same policy drift. The script must not carry its own
  // copy of the regexes.
  const body = readFileSync(script, 'utf8');
  assert.match(body, /commit-msg-guard\.sh/, 'the canonical source must be named');
  const guardBody = readFileSync(guard, 'utf8');
  const canonical = [...(guardBody.match(/PATTERNS=\(([\s\S]*?)\n\)/)[1].matchAll(/'([^']+)'/g))].map((m) => m[1]);
  assert.equal(canonical.length, 3, 'the guard should still declare three patterns');
  for (const pattern of canonical) {
    assert.ok(!body.includes(pattern), `the script must not restate the canonical pattern: ${pattern}`);
  }
});

test('a content path containing shell metacharacters is not expanded', () => {
  // The file is an operand, and `--` guards it. A path a user could plausibly
  // produce must not become a command.
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-odd-'));
  try {
    const file = join(dir, "body; touch pwned .md".replace(/ /g, '_'));
    writeFileSync(file, `## Summary\n${CO_AUTHOR}\n`);
    const r = spawnSync('bash', [script, 'body', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, `an unusual filename must still be readable: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /Co-Authored-By/, 'sanitization still applies');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a body line that looks like a grep option is treated as content', () => {
  // Without `--` before the file operand, and with content beginning `-e`, a
  // naive implementation would consume it as a flag.
  const r = run('body', `-e not an option\n${CO_AUTHOR}\n`);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /-e not an option/, 'content starting with a dash must survive');
});

test('the documented entrypoint resolves the script and the pattern source', () => {
  // SKILL.md invokes this through run-skill.sh, which exports PLUGIN_ROOT. If
  // that path did not resolve, Step 4b would fail at runtime while every direct
  // invocation in this file still passed.
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-entry-'));
  try {
    const file = join(dir, 'body.md');
    writeFileSync(file, `## Summary\n\nReal content.\n${CO_AUTHOR}\n`);
    const r = spawnSync('bash', [runner, 'create-pr', 'sanitize-pr-content.sh', 'body', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, `the documented entrypoint must work: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /Co-Authored-By/, 'sanitization must happen through the entrypoint');
    assert.match(r.stdout, /Real content\./);
    assert.match(r.stderr, /\[AI_STRIPPED\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the entrypoint is the exact form SKILL.md documents', () => {
  const skill = readFileSync(resolve(root, 'skills/create-pr/SKILL.md'), 'utf8');
  for (const mode of ['title', 'body-inplace', 'scan']) {
    assert.ok(
      skill.includes(`/bin/bash -p scripts/run-skill.sh create-pr sanitize-pr-content.sh ${mode} '<PR_BODY_DIR>/`),
      `SKILL.md should invoke ${mode} mode through run-skill.sh with -p`
    );
  }
  // `-p` is load-bearing, not style. Without it bash sources $BASH_ENV before
  // the wrapper's first line, and a startup file that exits 0 ends the run
  // successfully with the sanitizer never invoked at all.
  assert.doesNotMatch(
    skill,
    /^bash scripts\/run-skill\.sh create-pr sanitize-pr-content\.sh/m,
    'no unprivileged invocation may remain'
  );
});

/** A plugin tree carrying the REAL canonical patterns, for locale tests. */
function realRoot(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-locale-'));
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts/commit-msg-guard.sh'), readFileSync(guard));
  plantScript(dir);
  if (mutate !== undefined) {
    // A full, valid tree with exactly one line of the script changed — the way
    // to prove a guard is load-bearing rather than decorative. The tree has to
    // be complete because resolution is `<script>/../../..`, so a lone mutated
    // copy in a temp dir would fail on "policy source not found" and pass the
    // negative control for the wrong reason. Asserting the substitution applied
    // matters just as much: an edit that matched nothing is indistinguishable
    // from a surviving guard.
    const target = join(dir, 'skills/create-pr/scripts/sanitize-pr-content.sh');
    const source = readFileSync(target, 'utf8');
    const mutated = mutate(source);
    assert.notEqual(mutated, source, 'the mutation must actually apply');
    writeFileSync(target, mutated);
  }
  return dir;
}

// A latin-1 byte is not valid UTF-8. Written as a Buffer because a JS string
// would be encoded as UTF-8 on the way to disk, producing valid bytes and
// testing nothing.
const LATIN1_TRAILER = Buffer.from(`intro line\nCaf\xe9 ${CO_AUTHOR}\ntail line\n`, 'latin1');

test('a byte that is not valid UTF-8 on the trailer line cannot hide it', () => {
  // BSD grep in a UTF-8 locale returns 1 — "no match" — for such a line, and 1
  // is the clean branch. Commit messages carry latin-1 bytes routinely and PR
  // bodies are generated from them, so this published `Co-Authored-By: Claude`
  // while Step 4b and Step 7b both reported clean.
  const scan = run('scan', LATIN1_TRAILER);
  assert.equal(scan.status, 4, 'scan must detect a trailer on a non-UTF-8 line');
  assert.match(scan.stderr, /\[AI_DETECTED\] line 2 matched pattern 1/);

  const title = run('title', LATIN1_TRAILER);
  assert.equal(title.status, 3, 'title must reject it rather than accept it');

  const stripped = run('body-inplace', LATIN1_TRAILER, { keepFile: true });
  assert.equal(stripped.status, 0);
  assert.doesNotMatch(stripped.file, /Co-Authored-By/, 'the line must actually be removed');
  assert.match(stripped.file, /intro line[\s\S]*tail line/, 'other lines must survive');
});

test('valid multi-byte content is unaffected by the byte-wise match', () => {
  // The negative half: LC_ALL=C must not turn ordinary UTF-8 bodies into
  // false positives, and \bAI\b must stay bounded.
  const utf8 = run('body', '中文說明與 Café 字樣\na maintainer explained the domain\n');
  assert.equal(utf8.status, 0);
  assert.match(utf8.stdout, /中文說明與 Café 字樣/, 'multi-byte content must pass through intact');
  assert.doesNotMatch(utf8.stderr, /\[AI_STRIPPED\]/, 'no pattern may fire on clean text');
});


/**
 * Does the local grep actually exhibit the locale bypass? BSD grep in a UTF-8
 * locale reports a line carrying an invalid UTF-8 byte as non-matching (status
 * 1, the clean branch); GNU grep matches it anyway. The negative controls below
 * assert that removing `LC_ALL=C` REPRODUCES the defect, which is only true
 * where the defect exists — CI runs ubuntu-latest with GNU grep, so a control
 * written as an unconditional assertion fails there on a working fix. Measure
 * the premise instead of assuming the platform.
 */
function localeBypassExhibited() {
  const dir = mkdtempSync(join(tmpdir(), 'grep-premise-'));
  try {
    const f = join(dir, 'probe.txt');
    writeFileSync(f, Buffer.from('Caf\xe9 Co-Authored-By: Claude <x@y>\n', 'latin1'));
    const env = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };
    const r = spawnSync('grep', ['-Ei', '-e', 'Co-Authored-By:.*Claude', '--', f], { env });
    return r.status === 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const LOCALE_BYPASS = localeBypassExhibited();
const SKIP_LOCALE = LOCALE_BYPASS
  ? false
  : 'the local grep matches invalid-UTF-8 lines anyway (GNU grep), so the bypass this control reproduces does not exist here';

test('removing the locale pin reopens the bypass', (t) => {
  if (SKIP_LOCALE) return t.skip(SKIP_LOCALE);
  // Negative control. Without it the two tests above would still pass if the
  // fix were reverted for some unrelated reason — this asserts that the pin is
  // what does the work.
  const dir = realRoot();
  try {
    const target = join(dir, 'skills/create-pr/scripts/sanitize-pr-content.sh');
    const mutated = readFileSync(target, 'utf8').replace('LC_ALL=C grep -Eina', 'grep -Eina');
    assert.notEqual(mutated, readFileSync(target, 'utf8'), 'the mutation must actually apply');
    writeFileSync(target, mutated);
    const r = run('scan', LATIN1_TRAILER, { pluginRoot: dir });
    assert.equal(r.status, 0, 'without the pin the trailer is reported clean — this is the defect');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an entry the parser drops is caught by the declared-vs-parsed check', () => {
  // An empty entry `  ''` satisfies the single-element shape, so the shape
  // guard passes it — and then the `[ -n "$pat" ]` filter drops it. Only the
  // count comparison sees the difference, which makes this the one input that
  // reaches that check alone. Without a test, the check reads as redundant.
  // Three real patterns keep the "at least 3" guard satisfied, so the count
  // comparison is the only thing left that can notice the dropped fourth.
  const dir = fakeRoot([
    "  'Co-Authored-By:.*(Claude|Anthropic)'",
    "  'Generated (by|with).*(Claude|GPT)'",
    "  '🤖.*(Claude|GPT)'",
    "  ''",
  ].join('\n'));
  try {
    const r = run('scan', `${CO_AUTHOR}\n`, { pluginRoot: dir });
    assert.equal(r.status, 2, 'a dropped entry must abort, not enforce a subset');
    assert.match(r.stderr, /refusing to enforce a subset/);
    assert.match(r.stderr, /parsed 3 of 4 entries/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Environment-controlled policy selection — the utilities themselves
// ============================================================================

// Bash imports functions out of the environment before the script's first line
// runs, and an imported function beats both PATH lookup and the shell builtin
// of the same name. `unset -f grep` is no defence: a hostile `unset` shadows
// the builtin that would have cleared it.
const HOSTILE_GREP = { 'BASH_FUNC_grep%%': '() { return 1; }' };

test('an exported grep function cannot make published content look clean', () => {
  // Same class as the removed PLUGIN_ROOT override: the caller chooses the
  // enforcement outcome from the environment, and a total bypass of the policy
  // is indistinguishable from a body that never carried a trailer.
  const r = run('scan', `intro\n${CO_AUTHOR}\n`, { extraEnv: HOSTILE_GREP });
  assert.equal(r.status, 4, 'the trailer must still be detected');
});

test('an exported grep function cannot make body mode emit the trailer', () => {
  const r = run('body-inplace', `intro\n${CO_AUTHOR}\n`, {
    extraEnv: HOSTILE_GREP,
    keepFile: true,
  });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.file, /Co-Authored-By/, 'the line must actually be removed');
});

test('a re-exec that does not take aborts rather than running unprivileged', () => {
  // The second half of the control: `exec` is itself shadowable, so losing it
  // must not mean falling through into a poisoned shell. The abort runs through
  // `${x:?}` — a parameter expansion, which resolves before command lookup and
  // so cannot be intercepted by an imported `exit`, `echo` or `:`.
  const dir = realRoot((s) => {
    const m = s.replace(/^\s+exec \/usr\/bin\/env -u SHELLOPTS[\s\S]*?"\$@"$/m, '    :');
    assert.notEqual(m, s, 'the re-exec mutation must actually apply');
    return m;
  });
  try {
    const r = run('scan', `intro\n${CO_AUTHOR}\n`, { pluginRoot: dir, extraEnv: HOSTILE_GREP });
    assert.notEqual(r.status, 0, 'no privileged mode must never read as clean');
    assert.match(r.stderr, /privileged re-exec did not take/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removing the trust block entirely reopens the exported-function bypass', () => {
  // Negative control proper. With both halves gone the hostile function wins
  // and `scan` reports a real trailer as clean — which is what the shipped
  // script did before this fix, and what the two tests above would keep passing
  // through if the mechanism were dropped for an unrelated reason.
  const dir = realRoot((s) => {
    const start = s.indexOf('case "${SD0X_PRIV_REEXEC:-}" in');
    const endMark = 'unset SD0X_PRIV_REEXEC\n';
    const end = s.lastIndexOf(endMark);
    assert.ok(start >= 0 && end > start, 'the trust block must be locatable');
    return s.slice(0, start) + s.slice(end + endMark.length);
  });
  try {
    const r = run('scan', `intro\n${CO_AUTHOR}\n`, { pluginRoot: dir, extraEnv: HOSTILE_GREP });
    assert.equal(r.status, 0, 'unprivileged, the trailer is reported clean — this is the defect');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Status laundering in the strip-list pipeline
// ============================================================================

// A failing helper in `matched_lines | cut | sort | paste` used to be read as
// "clean": under pipefail a pipeline reports its LAST nonzero component, so a
// status-1 cut masked a scan that died with 2 — and 1 is the clean branch.
// Exit 1 is the status that laundered; 7 (the other tests' value) never did.
for (const utility of ['cut', 'sort', 'paste']) {
  test(`a ${utility} failing with 1 aborts instead of emitting the body unchanged`, () => {
    const r = run('body', `intro\n${CO_AUTHOR}\n`, {
      brokenUtility: utility,
      brokenStatus: 1,
    });
    assert.equal(r.status, 2, 'a broken helper is an environment failure, not a clean body');
    assert.doesNotMatch(r.stdout, /Co-Authored-By/, 'the hostile body must never reach stdout');
  });
}

test('body-inplace leaves the file untouched when the strip list cannot be built', () => {
  // The mode `gh pr edit --body-file` consumes. Emitting exit 0 here published
  // the original body while [AI_STRIPPED] was logged for it.
  const r = run('body-inplace', `intro\n${CO_AUTHOR}\n`, {
    brokenUtility: 'cut',
    brokenStatus: 1,
    keepFile: true,
  });
  assert.equal(r.status, 2);
  assert.match(r.file, /Co-Authored-By/, 'the file must be left for the caller, not silently accepted');
  assert.deepEqual(r.leftovers, [], 'no temp copy of the body may survive');
});

// ============================================================================
// Bash startup files — the channel no in-script guard can reach
// ============================================================================

/**
 * A $BASH_ENV startup file. Non-interactive bash sources it BEFORE the script's
 * first line, so `exit 0` ends the run successfully having executed no script
 * line at all. Nothing inside a script can pre-empt that; `-p` not processing
 * $BASH_ENV is the only defence, which is why it is in the shebang and in the
 * documented `/bin/bash -p scripts/run-skill.sh …` invocation.
 */
function withStartupFile(body, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-bashenv-'));
  try {
    const startup = join(dir, 'startup.sh');
    writeFileSync(startup, body);
    return fn(startup, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a $BASH_ENV startup file cannot silence the shebang invocation', () => {
  withStartupFile('exit 0\n', (startup, dir) => {
    const file = join(dir, 'content.md');
    writeFileSync(file, `intro\n${CO_AUTHOR}\n`);
    const r = spawnSync(script, ['scan', file], {
      encoding: 'utf8',
      env: { ...process.env, BASH_ENV: startup },
    });
    assert.equal(r.status, 4, 'the trailer must still be detected');
  });
});

test('the documented entrypoint survives a $BASH_ENV startup file', () => {
  withStartupFile('exit 0\n', (startup, dir) => {
    const file = join(dir, 'content.md');
    writeFileSync(file, `intro\n${CO_AUTHOR}\n`);
    // Exactly the form SKILL.md renders, `-p` included.
    const r = spawnSync('bash', ['-p', runner, 'create-pr', 'sanitize-pr-content.sh', 'scan', file], {
      encoding: 'utf8',
      env: { ...process.env, BASH_ENV: startup },
      cwd: root,
    });
    assert.equal(r.status, 4, 'the wrapper must reach the sanitizer');
  });
});

test('dropping -p from the shebang reopens the startup-file bypass', () => {
  // Negative control. The two tests above would keep passing on the strength of
  // the in-script re-exec alone, which cannot help here: the startup file runs
  // before the first line that re-execs.
  withStartupFile('exit 0\n', (startup, dir) => {
    const file = join(dir, 'content.md');
    writeFileSync(file, `intro\n${CO_AUTHOR}\n`);
    const planted = realRoot((s) => s.replace('#!/bin/bash -p\n', '#!/bin/bash\n'));
    try {
      const target = join(planted, 'skills/create-pr/scripts/sanitize-pr-content.sh');
      chmodSync(target, 0o755);
      const r = spawnSync(target, ['scan', file], {
        encoding: 'utf8',
        env: { ...process.env, BASH_ENV: startup },
      });
      assert.equal(r.status, 0, 'unprivileged, the startup file ends the run clean — this is the defect');
    } finally {
      rmSync(planted, { recursive: true, force: true });
    }
  });
});

test('an exported exec function cannot make the wrapper skip the sanitizer', () => {
  // `run-skill.sh` dispatches with `exec bash "$TARGET"`, and an imported `exec`
  // function returns success without launching anything — so the target's own
  // hardening never runs. The wrapper enters privileged mode first for exactly
  // this reason, and fails closed if that did not take.
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-wrapper-'));
  try {
    const file = join(dir, 'content.md');
    writeFileSync(file, `intro\n${CO_AUTHOR}\n`);
    for (const argv of [[runner, ...['create-pr', 'sanitize-pr-content.sh', 'scan', file]],
      ['-p', runner, ...['create-pr', 'sanitize-pr-content.sh', 'scan', file]]]) {
      const r = spawnSync('bash', argv, {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, 'BASH_FUNC_exec%%': '() { return 0; }' },
      });
      assert.notEqual(r.status, 0, `a skipped sanitizer must never read as clean (argv: ${argv[0]})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Inherited environment values. Privileged mode stops imported FUNCTIONS; these
// are values, and each was measured to produce a clean verdict on real content.
// ============================================================================

for (const opt of ['-x', '-m0', '-q', '-c', '-L', '-v']) {
  test(`GREP_OPTIONS=${opt} cannot make scan report a real trailer clean`, () => {
    const r = run('scan', `# Title\n\n${CO_AUTHOR}\n`, { extraEnv: { GREP_OPTIONS: opt } });
    assert.equal(r.status, 4,
      `GREP_OPTIONS=${opt} must not change the verdict (stderr: ${r.stderr})`);
  });

  test(`GREP_OPTIONS=${opt} cannot make body emit the trailer untouched`, () => {
    const r = run('body', `# Title\n\n${CO_AUTHOR}\n`, { extraEnv: { GREP_OPTIONS: opt } });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Co-Authored-By/,
      `GREP_OPTIONS=${opt} must not let a real trailer through the sanitized body`);
  });
}

/**
 * GNU grep >= 2.21 ignores GREP_OPTIONS, so on ubuntu CI the control below has
 * nothing to reproduce. Report that as SKIPPED, not as a pass — a control that
 * quietly returns is indistinguishable in the summary from one that verified
 * something, which is the failure mode this whole file exists to avoid.
 */
function grepOptionsHonoured() {
  const probeDir = mkdtempSync(join(tmpdir(), 'grep-opt-premise-'));
  try {
    const f = join(probeDir, 'f');
    writeFileSync(f, 'abcdef\n');
    return spawnSync('grep', ['-E', 'bcd', f], {
      env: { ...process.env, GREP_OPTIONS: '-x' },
    }).status === 1;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}
const SKIP_GREP_OPTIONS = grepOptionsHonoured()
  ? false
  : 'this grep ignores GREP_OPTIONS (GNU >= 2.21), so the bypass this control reproduces does not exist here';

test('GREP_OPTIONS negative control: unpinned, the bypass reproduces',
  { skip: SKIP_GREP_OPTIONS }, () => {
  // Measure the premise on a complete tree with only the pin removed.
  const unpinned = realRoot((src) => src.replace("GREP_OPTIONS=''\nexport GREP_OPTIONS\n", ''));
  try {
    const r = run('scan', `# Title\n\n${CO_AUTHOR}\n`, {
      pluginRoot: unpinned,
      extraEnv: { GREP_OPTIONS: '-x' },
    });
    assert.equal(r.status, 0,
      'unpinned, GREP_OPTIONS=-x makes a real trailer scan clean — that is the hole being closed');
  } finally {
    rmSync(unpinned, { recursive: true, force: true });
  }
});

test('a hostile PATH cannot substitute the grep that decides the verdict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-evil-path-'));
  try {
    writeFileSync(join(dir, 'grep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const r = run('scan', `# Title\n\n${CO_AUTHOR}\n`, {
      extraEnv: { PATH: `${dir}:${process.env.PATH}` },
    });
    assert.equal(r.status, 4,
      `a planted "always clean" grep must not be consulted (stderr: ${r.stderr})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a hostile PATH cannot substitute the sed that reads the policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-evil-sed-'));
  try {
    // Emits three patterns that match nothing — every count check downstream is
    // satisfied, so only the PATH pin can reject this.
    writeFileSync(
      join(dir, 'sed'),
      "#!/bin/sh\nprintf '%s\\n' 'nope-aaa' 'nope-bbb' 'nope-ccc'\nexit 0\n",
      { mode: 0o755 }
    );
    const r = run('scan', `# Title\n\n${CO_AUTHOR}\n`, {
      extraEnv: { PATH: `${dir}:${process.env.PATH}` },
    });
    assert.notEqual(r.status, 0,
      `a planted policy reader must not yield a clean verdict (stderr: ${r.stderr})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hostile-PATH negative control: unpinned, the planted grep IS consulted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-evil-ctl-'));
  const unpinned = realRoot((src) =>
    src.replace("PATH='/usr/bin:/bin:/usr/sbin:/sbin'\nexport PATH\n", ''));
  try {
    writeFileSync(join(dir, 'grep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const r = run('scan', `# Title\n\n${CO_AUTHOR}\n`, {
      pluginRoot: unpinned,
      extraEnv: { PATH: `${dir}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0,
      'unpinned, the planted grep answers and a real trailer scans clean — the hole being closed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(unpinned, { recursive: true, force: true });
  }
});

// ============================================================================
// The documented entrypoint, exactly as SKILL.md renders it.
// ============================================================================

test('the documented /bin/bash -p entrypoint survives a hostile exported `bash` function', () => {
  // A bare `bash -p …` is resolved in the CALLER's shell, before privileged mode
  // exists, so an exported `bash` function answered the whole command with exit 0
  // and neither the wrapper nor this script ever started.
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-entry-'));
  try {
    const file = join(dir, 'body.md');
    writeFileSync(file, `# Title\n\n${CO_AUTHOR}\n`);
    const r = spawnSync(
      '/bin/bash',
      ['-c', `/bin/bash -p '${runner}' create-pr sanitize-pr-content.sh scan '${file}'`],
      {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, 'BASH_FUNC_bash%%': '() { return 0; }' },
      }
    );
    assert.equal(r.status, 4,
      `the real policy must run and detect the trailer (stdout: ${r.stdout}, stderr: ${r.stderr})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('entrypoint negative control: the bare `bash -p` form IS answered by the hostile function', () => {
  // The control for the spelling. If this ever stops exiting 0, the absolute
  // form is no longer buying anything and the claim in SKILL.md should be
  // re-examined rather than left standing.
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-entry-ctl-'));
  try {
    const file = join(dir, 'body.md');
    writeFileSync(file, `# Title\n\n${CO_AUTHOR}\n`);
    const r = spawnSync(
      '/bin/bash',
      ['-c', `bash -p '${runner}' create-pr sanitize-pr-content.sh scan '${file}'`],
      {
        encoding: 'utf8',
        cwd: root,
        env: { ...process.env, 'BASH_FUNC_bash%%': '() { return 0; }' },
      }
    );
    assert.equal(r.status, 0,
      'spelled bare, the hostile function answers and nothing runs — why the docs spell it /bin/bash');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a wrapper reached through a symlink still selects the REAL policy script', () => {
  // Planted-tree attack on the documented entrypoint: a symlink to the genuine
  // wrapper, dropped in a tree the caller controls, used to dispatch that tree's
  // copy of this script — one that need only exit 0.
  const planted = mkdtempSync(join(tmpdir(), 'sanitize-planted-'));
  try {
    mkdirSync(join(planted, 'scripts'), { recursive: true });
    mkdirSync(join(planted, 'skills/create-pr/scripts'), { recursive: true });
    symlinkSync(runner, join(planted, 'scripts/run-skill.sh'));
    writeFileSync(
      join(planted, 'skills/create-pr/scripts/sanitize-pr-content.sh'),
      '#!/bin/bash\nexit 0\n',
      { mode: 0o755 }
    );
    const file = join(planted, 'body.md');
    writeFileSync(file, `# Title\n\n${CO_AUTHOR}\n`);

    const r = spawnSync(
      '/bin/bash',
      ['-p', join(planted, 'scripts/run-skill.sh'), 'create-pr', 'sanitize-pr-content.sh', 'scan', file],
      { encoding: 'utf8', cwd: root }
    );
    assert.equal(r.status, 4,
      `the genuine policy must run and detect the trailer, got ${r.status} (stderr: ${r.stderr})`);
  } finally {
    rmSync(planted, { recursive: true, force: true });
  }
});

// ============================================================================
// POSIXLY_CORRECT is parse-time
//
// bash disables `<(…)` process substitution WHILE PARSING in POSIX mode, so a
// script using it becomes a syntax error before line one runs — nothing inside
// the file can compensate. An exported POSIXLY_CORRECT=1 is a legitimate
// setting, and it took the whole sanitization path down (fail-closed, but a
// complete denial). The shipped implementation therefore uses neither: it splits
// on a newline `IFS` into an array and iterates that. A here-string would parse
// in POSIX mode too, but this file separately asserts that none is present —
// `<<<` is close enough to a heredoc that the "no heredocs" contract keeps it out.
// ============================================================================

for (const mode of ['title', 'scan']) {
  test(`POSIXLY_CORRECT=1 does not break ${mode} detection`, () => {
    const violating = run(mode, 'x\nCo-Authored-By: Claude <noreply@anthropic.com>\n',
      { extraEnv: { POSIXLY_CORRECT: '1' } });
    assert.equal(violating.status, mode === 'title' ? 3 : 4,
      `POSIX mode must not turn the sanitizer into a syntax error (stderr: ${violating.stderr})`);
    const clean = run(mode, 'ordinary title\nordinary body\n',
      { extraEnv: { POSIXLY_CORRECT: '1' } });
    assert.equal(clean.status, 0, clean.stderr);
  });
}

test('POSIXLY_CORRECT=1 leaves body stripping byte-identical', () => {
  const content = 'summary line\n\nGenerated by Claude\nkept line\n';
  const plain = run('body', content);
  const posix = run('body', content, { extraEnv: { POSIXLY_CORRECT: '1' } });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(posix.status, 0, posix.stderr);
  assert.equal(posix.stdout, plain.stdout,
    'POSIX mode must change nothing about what is stripped');
  assert.ok(!posix.stdout.includes('Generated by Claude'), posix.stdout);
  assert.ok(posix.stdout.includes('kept line'), posix.stdout);
});

for (const [label, target] of [['sanitizer', script], ['commit-msg guard', guard]]) {
  test(`${label} parses under bash --posix (measured, not asserted by pattern)`, () => {
    // Measured rather than grepped for `<(`: the string appears legitimately in
    // prose explaining WHY it is not used, and a comment is not a parse error.
    // `-n` parses without executing, which is exactly the property at stake.
    const r = spawnSync('/bin/bash', ['--posix', '-n', target], { encoding: 'utf8' });
    assert.equal(r.status, 0,
      `POSIX mode must not make this a syntax error: ${r.stderr}`);
  });
}

test('mutation control: process substitution WOULD fail the posix parse check', () => {
  // Without this the check above could pass for a script that simply has no
  // loops left. Reintroduce the construct and confirm the measurement notices.
  const dir = mkdtempSync(join(tmpdir(), 'posix-ctl-'));
  try {
    const copy = join(dir, 'mutant.sh');
    writeFileSync(copy, '#!/bin/bash\nwhile read -r l; do echo "$l"; done < <(printf \'a\\n\')\n');
    const r = spawnSync('/bin/bash', ['--posix', '-n', copy], { encoding: 'utf8' });
    assert.notEqual(r.status, 0,
      'if this parses, the check above proves nothing about POSIX mode');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Availability: the hardening must not trade one denial for another
//
// The POSIXLY_CORRECT fix first replaced process substitution with here-strings.
// That parses in POSIX mode — but bash 3.2, the bash macOS ships, implements a
// here-string with a TEMPORARY FILE, so even the read-only `title` and `scan`
// modes then failed when TMPDIR was unwritable. Splitting on a newline IFS needs
// neither construct.
// ============================================================================

const BAD_TMPDIR = { TMPDIR: '/definitely/not/a/writable/directory' };

for (const [mode, violatingStatus] of [['title', 3], ['scan', 4]]) {
  test(`${mode} works with an unwritable TMPDIR`, () => {
    const violating = run(mode, `intro\n${CO_AUTHOR}\n`, { extraEnv: BAD_TMPDIR });
    assert.equal(violating.status, violatingStatus,
      `a read-only mode must not need writable temporary storage (stderr: ${violating.stderr})`);
    const clean = run(mode, 'ordinary title\nordinary body\n', { extraEnv: BAD_TMPDIR });
    assert.equal(clean.status, 0, clean.stderr);
  });
}

test('title and scan work with an unwritable TMPDIR AND POSIXLY_CORRECT together', () => {
  // The two constraints were fixed in sequence and each fix could reintroduce
  // the other's failure; only the combination pins that neither did.
  const both = { ...BAD_TMPDIR, POSIXLY_CORRECT: '1' };
  assert.equal(run('scan', `intro\n${CO_AUTHOR}\n`, { extraEnv: both }).status, 4);
  assert.equal(run('title', `intro\n${CO_AUTHOR}\n`, { extraEnv: both }).status, 3);
  const body = run('body', `summary\n\n${CO_AUTHOR}\nkept line\n`, { extraEnv: both });
  assert.equal(body.status, 0, body.stderr);
  assert.ok(!body.stdout.includes('Co-Authored-By'), body.stdout);
  assert.ok(body.stdout.includes('kept line'), body.stdout);
});

test('the sanitizer uses neither process substitution nor a here-string to feed a loop', () => {
  // Both were tried and both broke something. Pinned structurally so the next
  // edit does not silently reintroduce either dependency; the comments in the
  // file explain which construct failed which way.
  const source = readFileSync(script, 'utf8');
  const code = source.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.ok(!/done\s*<<</.test(code), 'a here-string needs a temp file on bash 3.2');
  assert.ok(!/done\s*<\s*<\(/.test(code), 'process substitution is a parse error in POSIX mode');
});

// ============================================================================
// `$-` is not proof of a secure start (see the same section in the guard tests)
// ============================================================================

for (const [label, env] of [
  ['SHELLOPTS=privileged', { SHELLOPTS: 'privileged' }],
  ['BASHOPTS inherited', { BASHOPTS: 'checkwinsize' }],
]) {
  test(`a forged privileged mode (${label}) cannot make scan report a trailer clean`, () => {
    const r = run('scan', `intro\n${CO_AUTHOR}\n`, {
      extraEnv: { ...env, ...HOSTILE_GREP },
    });
    assert.equal(r.status, 4, `the hostile grep must not survive (stderr: ${r.stderr})`);
  });
}

test('pre-setting the re-exec marker fails closed, never open', () => {
  const r = run('scan', `intro\n${CO_AUTHOR}\n`, {
    extraEnv: { SD0X_PRIV_REEXEC: '1', ...HOSTILE_GREP },
  });
  assert.notEqual(r.status, 0, 'a forged marker must never read as clean');
  assert.match(r.stderr, /cannot establish bash privileged mode/);
});

test('a legitimate SHELLOPTS export still lets clean content through', () => {
  const r = run('scan', 'ordinary title\nordinary body\n', {
    extraEnv: { SHELLOPTS: 'privileged' },
  });
  assert.equal(r.status, 0, r.stderr);
});

// ============================================================================
// Round 41 — no environment scan at all
//
// Round 40 line-anchored the scan; round 41 measured that a value may legitimately
// contain NEWLINES (CI metadata, certificates, release notes), so no textual anchor
// separates a real variable from a line of someone's data. The scan is gone: the
// re-exec is unconditional, which cannot misclassify anything.
// ============================================================================

for (const [label, extraEnv] of [
  ['single-line BASH_ENV mention', { NOTE: 'documentation says BASH_ENV=ignored here' }],
  ['multiline BASH_ENV line', { NOTE: 'ordinary CI metadata\nBASH_ENV=whatever' }],
  ['multiline SHELLOPTS line', { NOTE: 'release notes\nSHELLOPTS=privileged' }],
  ['multiline BASHOPTS line', { CI_NOTE: 'cert body\nBASHOPTS=checkwinsize' }],
]) {
  test(`a ${label} in an unrelated variable is not a denial`, () => {
    const r = run('title', 'feat: ordinary title\n', { extraEnv });
    assert.equal(r.status, 0, `must not refuse (stderr: ${r.stderr})`);
  });
}

test('the sanitizer scans no environment and states its residual', () => {
  const raw = readFileSync(script, 'utf8');
  const src = raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/\$\(\/usr\/bin\/env\)/.test(src), 'no environment read may remain');
  assert.ok(!/SD0X_ENV=/.test(src), 'the scanned-environment variable must be gone');
  assert.match(src, /^case "\$\{SD0X_PRIV_REEXEC:-\}" in$/m,
    'the branch must be a `case` — a reserved word an imported function cannot answer');
  assert.ok(!/^\s*if \[ /m.test(src.split('unset SD0X_PRIV_REEXEC')[0]),
    'no `[` may decide anything in the trust block; `[` is a shadowable command');
  assert.match(raw, /Residual: a caller who controls the invoking shell/,
    'the preamble must state the residual it cannot close');
  assert.ok(!/path containing `\/` is not/.test(raw),
    'the false "cannot be shadowed" claim must stay gone');
});

test('documented residual: a pre-set marker plus SHELLOPTS=privileged reaches the verdict', () => {
  // The test above checks that the preamble SAYS this; this one checks that the script
  // DOES it. Prose and behaviour drift apart silently otherwise — a residual could be
  // closed, or widened, with the sentence untouched.
  //
  // Positive proof, not an absence: a real trailer is reported CLEAN (exit 0) because
  // the hostile `grep` survived, and `run()`'s own control below shows the same content
  // is exit 4 without the marker. Measured on the way in: `SHELLOPTS=privileged` in the
  // environment does not stop bash importing exported functions, which is why both
  // halves are needed. If a future change rejects a pre-set marker, this fails.
  const failingGrep = { 'BASH_FUNC_grep%%': '() { return 1; }' };
  const leak = `intro\n${CO_AUTHOR}\n`;
  const residual = run('scan', leak, {
    extraEnv: { ...failingGrep, SD0X_PRIV_REEXEC: '1', SHELLOPTS: 'privileged' },
  });
  assert.equal(residual.status, 0,
    'the documented residual must still reproduce — otherwise update the preamble and this test');

  const reexeced = run('scan', leak, { extraEnv: failingGrep });
  assert.equal(reexeced.status, 4,
    'and without the marker the re-exec strips that function — the leak is caught');
});

test('an imported `[` function cannot make scan report a trailer clean', () => {
  // Round 42. `[` is an ordinary COMMAND, so a function named `[` wins lookup and
  // answers the branch. While the block opened with `if [ -z ... ]` that alone
  // suppressed the re-exec, leaving the hostile grep in place. The branch is now a
  // `case`, which the grammar resolves and no function can intercept.
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-bracket-'));
  try {
    const startup = join(dir, 'startup.sh');
    writeFileSync(startup, [
      'function [ () { return 1; }',
      'function grep(){ return 1; }',
      'set -o privileged',
      'unset BASH_ENV',
      '',
    ].join('\n'));
    const r = run('scan', `intro\n${CO_AUTHOR}\n`, { extraEnv: { BASH_ENV: startup } });
    assert.equal(r.status, 4, 'the trailer must still be reported as a published leak');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('negative control: branching on `[` lets that startup file win', () => {
  // Without this, the test above proves only that SOMETHING failed. Restore the pre-fix
  // shape in a complete tree and the same startup file survives into the script body —
  // the exact outcome is stated at the assertion below, and it is a fail-closed denial,
  // not a clean verdict. `set -o privileged` is part of the fixture because the second-pass
  // `case "$-"` was already a reserved word — a shadowed `[` alone still gets caught
  // there, so the startup file has to turn `-p` on itself for the bypass to reproduce.
  const dir = mkdtempSync(join(tmpdir(), 'sanitize-bracket-ctl-'));
  try {
    const startup = join(dir, 'startup.sh');
    writeFileSync(startup, [
      'function [ () { return 1; }',
      'function grep(){ return 1; }',
      'set -o privileged',
      'unset BASH_ENV',
      '',
    ].join('\n'));

    const root = realRoot((s) => {
      let out = s.replace(
        'case "${SD0X_PRIV_REEXEC:-}" in\n  \'\')\n',
        'if [ -z "${SD0X_PRIV_REEXEC:-}" ]; then\n'
      );
      out = out.replace('    ;;\nesac\n# Second pass.', 'fi\n# Second pass.');
      assert.ok(!out.includes('case "${SD0X_PRIV_REEXEC:-}" in'),
        'the marker branch must really have become an `if [`');
      return out;
    });

    const parses = spawnSync('/bin/bash', ['-n',
      join(root, 'skills/create-pr/scripts/sanitize-pr-content.sh')], { encoding: 'utf8' });
    assert.equal(parses.status, 0, `the mutant must still parse: ${parses.stderr}`);
    const sane = run('scan', `intro\n${CO_AUTHOR}\n`, { pluginRoot: root });
    assert.equal(sane.status, 4,
      'and must behave normally when no hostile startup file is present');

    // What the mutant proves is that the imported functions SURVIVED into the script
    // body, and the observable is precise: this script also uses `[` for its own file
    // check, so the shadowed `[` makes it refuse a file that plainly exists. For the
    // sanitizer the surviving-function outcome is a fail-closed denial rather than a
    // clean verdict — worth stating exactly, since "non-zero" alone would have been
    // satisfied by the fixed script too, and that is the ambiguity this control removes.
    const r = run('scan', `intro\n${CO_AUTHOR}\n`, {
      pluginRoot: root, extraEnv: { BASH_ENV: startup },
    });
    assert.equal(r.status, 2,
      'with `[` deciding the branch the hostile functions reach the body — the defect being fixed');
    assert.match(r.stderr, /file not found/,
      'and the shadowed `[` is what answered the file check, not some unrelated failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
