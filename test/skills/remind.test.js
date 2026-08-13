const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/remind/SKILL.md');

// --- SKILL.md content assertions ---

test('remind SKILL.md has smart detection reading reminder state', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /detection/i, 'should mention detection');
  assert.match(content, /state/i, 'should reference the reminder state');
});

test('remind SKILL.md has rule loading via Read tool', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /rules?\//i, 'should reference rules/ directory');
  assert.match(content, /Read/i, 'should use Read tool');
});

test('remind SKILL.md has --all nuclear mode', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /--all/, 'should have --all flag');
});

test('remind SKILL.md has output format with Rule Context', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Finding/i, 'should have findings in output');
  assert.match(content, /Rule Context/i, 'should have Rule Context section');
});


// --- Catalog registration ---

test('docs/skill-catalog.yml registers /remind', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/remind$/m, '/remind must be registered in the skill catalog');
});

// --- Extraction-target liveness ---
// The skill's value is quoting real rule text; a mapping that names a section which no longer
// exists silently degrades /remind into memory-based correction. Every "Section to Extract"
// target named by SKILL.md / detection-rules.md must exist in its source file.

test('remind extraction targets exist in rules/auto-loop.md', () => {
  const autoLoop = readFileSync(resolve(root, 'rules/auto-loop.md'), 'utf8');
  assert.match(autoLoop, /Terminal completion invariant/, 'detections 1-2 extract the invariant paragraph');
  assert.match(autoLoop, /^Gate sequence:/m, 'detection 3 extracts the Gate sequence paragraph');
  assert.match(autoLoop, /^## Tiers$/m, 'the Gate sequence paragraph is anchored inside § Tiers');
});

test('remind extraction targets exist in CLAUDE.md (nuclear mode + detection 5)', () => {
  const claudeMd = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /^## Required Checks/m, 'detection 5 + --all extract the Required Checks table');
  assert.match(claudeMd, /^## Auto-Loop$/m, '--all extracts the Auto-Loop section');
});

test('remind mappings do not reference sections removed by the auto-loop rewrite', () => {
  const skill = readFileSync(skillPath, 'utf8');
  const detection = readFileSync(resolve(root, 'skills/remind/references/detection-rules.md'), 'utf8');
  for (const [label, content] of [['SKILL.md', skill], ['detection-rules.md', detection]]) {
    assert.ok(!content.includes('The Four Anchors'), `${label} references removed section "The Four Anchors"`);
    assert.ok(!content.includes('Auto-Trigger'), `${label} references removed section "Auto-Trigger"`);
    assert.ok(!content.includes('## Auto-Loop Rule` section'), `${label} references removed CLAUDE section`);
  }
});

// --- Reference file assertions ---

test('detection-rules.md exists with auto-loop mapping', () => {
  const path = resolve(root, 'skills/remind/references/detection-rules.md');
  assert.ok(existsSync(path), 'detection-rules.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /auto-loop/i, 'should reference auto-loop rule');
});

// --- Hook-lightweighting: the verdict source is review-state.js, and the state slot is
// --- never read directly ---
//
// These execute the skill's own Step 1 block rather than pattern-matching it: a
// grep over instruction text stays green when the executable lines are deleted.

const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');

function step1Block() {
  const skill = readFileSync(skillPath, 'utf8');
  const after = skill.slice(skill.indexOf('### Step 1'));
  const open = after.indexOf('```bash') + '```bash\n'.length;
  return after.slice(open, after.indexOf('```', open));
}

// Hermetic: every child gets its own HOME, cache and TMPDIR, and inherits no
// GIT_* variable. Without this the checker writes state slots into the
// developer's real ~/.cache, and an ambient core.hooksPath / commit.gpgSign / a
// GIT_DIR left over from a hook run decides what the assertions below see.
function harnessEnv(rootDir, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_')) env[k] = v;
  }
  return {
    ...env,
    HOME: resolve(rootDir, 'home'),
    XDG_CACHE_HOME: resolve(rootDir, 'cache'),
    // Git reads ~/.config/git/config through XDG_CONFIG_HOME; leaving it inherited
    // lets a developer's core.excludesFile or status.renames decide the fixtures.
    // System config is deliberately NOT neutralized: the only lever is
    // GIT_CONFIG_NOSYSTEM, which the block's own fence unsets by design.
    XDG_CONFIG_HOME: resolve(rootDir, 'home', '.config'),
    TMPDIR: resolve(rootDir, 'tmp'),
    PATH: `${resolve(rootDir, 'bin')}:${process.env.PATH}`,
    ...extra,
  };
}

// `shell` defaults to bash because that is what every case below was written against.
// It is a parameter rather than a constant so the portability case can re-run the same
// fixture under zsh — the shell the session actually pastes this block into. Nothing
// in the probe line may be bash-only either: `type -t` was, so it is `typeset -f`,
// which reports function existence identically in both.
function runStep1(build, { subdir = '', env: extraEnv = {}, shellPrelude = '', shell = 'bash' } = {}) {
  const rootDir = mkdtempSync(resolve(tmpdir(), 'remind-harness-'));
  try {
    for (const d of ['repo', 'home', 'cache', 'tmp', 'bin']) mkdirSync(resolve(rootDir, d));
    const repo = resolve(rootDir, 'repo');
    const env = harnessEnv(rootDir);
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], { env });
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
    git('config', 'user.email', 'harness@sd0x.invalid');
    git('config', 'user.name', 'harness');
    build(repo, git, rootDir);

    const script = `${shellPrelude}${step1Block()}\nprintf '%s %s %s %s %s %s %s %s %s %s\\n' "$HAS_CODE" "$HAS_DOC" "$CODE_REVIEW" "$DOC_REVIEW" "$PRECOMMIT" "$CODE_NOTED" "$DOC_NOTED" "\${BRANCH:-none}" "\${DIRTY:+dirty}" "$(for f in _remind_git _remind_bool; do typeset -f "$f" >/dev/null 2>&1 && printf '%s,' "$f"; done || true)"\n`;
    const started = Date.now();
    const out = execFileSync(shell, ['-c', script], {
      cwd: resolve(repo, subdir),
      encoding: 'utf8',
      env: harnessEnv(rootDir, typeof extraEnv === 'function' ? extraEnv(repo) : extraEnv),
    }).trim().split('\n').pop();
    const [hasCode, hasDoc, codeReview, docReview, precommit, codeNoted, docNoted, branch, dirty, fnLeft] = out.split(' ');
    return {
      hasCode, hasDoc, codeReview, docReview, precommit, codeNoted, docNoted, branch,
      dirty: dirty || '', fnLeft: fnLeft || '', elapsedMs: Date.now() - started,
    };
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

// The layout /install-scripts produces: the checker at `.claude/scripts/`, with its
// one library dependency beside it. `review-state.js` requires `./lib/tree-digest.js`
// relative to its own directory, so the pair travels together.
function installChecker(repo) {
  mkdirSync(resolve(repo, '.claude/scripts/lib'), { recursive: true });
  cpSync(resolve(root, 'scripts/review-state.js'), resolve(repo, '.claude/scripts/review-state.js'));
  cpSync(resolve(root, 'scripts/lib/tree-digest.js'), resolve(repo, '.claude/scripts/lib/tree-digest.js'));
}

function fakeChecker(repo, body) {
  mkdirSync(resolve(repo, '.claude/scripts'), { recursive: true });
  writeFileSync(resolve(repo, '.claude/scripts/review-state.js'), body);
}

// Record a real note the way a producer would: the repo's own checker, run against
// the fixture repository, writing into the harness HOME. The slot lands under the
// non-contractual repo key — which is exactly why every read below must go through
// the checker rather than the filesystem.
function noteGate(repo, rootDir, plane, verdict) {
  execFileSync(process.execPath, [resolve(root, 'scripts/review-state.js'), 'note', plane, verdict], {
    cwd: repo, env: harnessEnv(rootDir), stdio: 'ignore',
  });
}

function commitBase(repo, git) {
  writeFileSync(resolve(repo, 'app.js'), 'module.exports = 1;\n');
  writeFileSync(resolve(repo, 'guide.md'), '# Guide\n');
  // As real projects do — otherwise the installed checker is itself untracked
  // content, and "clean tree, with notes recorded and a checker installed" is a
  // state no fixture could build.
  writeFileSync(resolve(repo, '.gitignore'), '.claude/\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
}

function dirtyTree(repo, git) {
  commitBase(repo, git);
  writeFileSync(resolve(repo, 'app.js'), 'module.exports = 2;\n');
}

test('remind Step 1 in a consuming project resolves through the INSTALLED checker path', () => {
  // Arrange: only `.claude/scripts/` exists — the layout /install-scripts produces.
  // A precommit PASS noted on the clean tree, then a code edit under it.
  const seen = runStep1((repo, git, rootDir) => {
    commitBase(repo, git);
    installChecker(repo);
    noteGate(repo, rootDir, 'precommit', 'pass');
    writeFileSync(resolve(repo, 'app.js'), 'module.exports = 2;\n');
  });

  // Assert: per-plane classification is the proof the installed checker answered —
  // the git fallback opens both planes on this same tree. And the stale note must
  // not survive the digest comparison.
  assert.equal(seen.hasCode, 'true', 'a modified .js must open the code plane');
  assert.equal(seen.hasDoc, 'false', 'no doc-plane file changed — only the checker can say so');
  assert.equal(seen.precommit, 'false', 'a PASS noted on the pre-edit digest must not survive the edit');
});

test('remind Step 1 with no checker installed reads no verdict at all, clean tree included', () => {
  // The slots exist in HOME with three PASSes in them — available to be borrowed.
  // But they are keyed by a non-contractual hash and carry no binding a degraded
  // run can verify: a clean `git status` says nothing is uncommitted *now*, which
  // is equally true one checkout later. The degraded run answers the change
  // question and stops there.
  const seen = runStep1((repo, git, rootDir) => {
    commitBase(repo, git);
    for (const plane of ['code_review', 'doc_review', 'precommit']) noteGate(repo, rootDir, plane, 'pass');
  });

  assert.equal(seen.precommit, 'false', 'an unreachable PASS is not a verdict, however clean the tree');
  assert.equal(seen.codeReview, 'false', 'the same for the code gate');
  assert.equal(seen.docReview, 'false', 'and the doc gate');
  assert.equal(seen.codeNoted, 'false', 'the noted flags have no source either — detection 5 stays quiet');
  assert.equal(seen.hasCode, 'false', 'the change question is still answered, and this tree is clean');
});

test('remind Step 1 refuses a PASS noted against a different commit', () => {
  // The exact scenario content addressing exists for: three PASSes noted on commit
  // A, then a commit B whose tree is just as clean. Every cheap local signal is
  // identical in both states; the digest is not.
  const seen = runStep1((repo, git, rootDir) => {
    commitBase(repo, git);
    installChecker(repo);
    for (const plane of ['code_review', 'doc_review', 'precommit']) noteGate(repo, rootDir, plane, 'pass');
    writeFileSync(resolve(repo, 'app.js'), 'module.exports = 2;\n');
    writeFileSync(resolve(repo, 'guide.md'), '# Guide, revised\n');
    git('add', '-A');
    git('commit', '-qm', 'B: unrelated work, committed — tree clean again');
  });

  assert.equal(seen.dirty, '', 'commit B leaves a clean tree, exactly like commit A');
  assert.equal(seen.codeReview, 'false', 'a PASS from commit A cannot close commit B\'s code gate');
  assert.equal(seen.docReview, 'false', 'nor its doc gate');
  assert.equal(seen.precommit, 'false', 'nor its precommit gate');
  assert.equal(seen.codeNoted, 'true', 'the note is still there — stale, which is not the same as absent');
});

test('remind Step 1 keeps per-plane freshness: a code edit does not stale the doc note', () => {
  // The digest is per plane. A doc_review PASS noted on this tree stays bound to
  // the doc plane's content, which a code-only edit does not move — so the doc
  // gate stays closed while the code plane opens. The old repo-local mirror could
  // not make this distinction; the checker's whole point is that it can.
  const seen = runStep1((repo, git, rootDir) => {
    commitBase(repo, git);
    installChecker(repo);
    noteGate(repo, rootDir, 'doc_review', 'pass');
    writeFileSync(resolve(repo, 'app.js'), 'module.exports = 2;\n');
  });

  assert.equal(seen.hasCode, 'true', 'the code plane is dirty');
  assert.equal(seen.hasDoc, 'false', 'the doc plane is not');
  assert.equal(seen.docReview, 'true', 'the doc-plane digest did not move, so its PASS still binds');
  assert.equal(seen.codeReview, 'false', 'the code plane has no note at all');
});

test('remind Step 1 refuses stale notes on a tree that moved under them', () => {
  // The All Clear this skill must never produce: every slot a PASS, and a dirty
  // tree. A slot records that a gate was noted, not which tree earned it — the
  // digest comparison is the binding, and it fails here.
  const seen = runStep1((repo, git, rootDir) => {
    commitBase(repo, git);
    installChecker(repo);
    for (const plane of ['code_review', 'doc_review', 'precommit']) noteGate(repo, rootDir, plane, 'pass');
    writeFileSync(resolve(repo, 'app.js'), 'module.exports = 2;\n');
    writeFileSync(resolve(repo, 'guide.md'), '# Guide, revised\n');
  });

  assert.equal(seen.hasCode, 'true', 'the dirty tree owes the code plane');
  assert.equal(seen.hasDoc, 'true', 'and the doc plane');
  assert.equal(seen.codeReview, 'false', 'a stale PASS cannot close the code gate');
  assert.equal(seen.docReview, 'false', 'nor the doc gate');
  assert.equal(seen.precommit, 'false', 'nor precommit — this is the row that would mint All Clear');
  assert.equal(seen.codeNoted, 'true', 'noted-but-stale is visible, so detection 5 does not misfire');
  assert.equal(seen.docNoted, 'true', 'both planes carry their note');
});

// The tree is asked once, and everything downstream reads that one answer. Two
// probes can disagree — a concurrent editor, a build touching the tree, a wrapper
// answering differently — and a step that classified from one while reporting
// `DIRTY` from the other described two different trees at once. The shim makes the
// disagreement deterministic instead of racing for it.
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

function gitShim(rootDir, answers, counter) {
  const shim = resolve(rootDir, 'bin/git');
  writeFileSync(shim, `#!/bin/sh
for a in "$@"; do
  [ "$a" = "status" ] || continue
  n=$(cat ${JSON.stringify(counter)} 2>/dev/null || echo 0); n=$((n + 1))
  echo "$n" > ${JSON.stringify(counter)}
  case "$n" in
${answers.map((a, i) => `    ${i + 1}) ${a} ;;`).join('\n')}
    *) ${answers[answers.length - 1]} ;;
  esac
done
exec ${JSON.stringify(REAL_GIT)} "$@"
`);
  execFileSync('chmod', ['+x', shim]);
}

const CLEAN = 'exit 0';
const DIRTY_ANSWER = 'echo " M app.js"; exit 0';
const BROKEN = 'exit 128';

for (const [name, answers, expectDirty] of [
  ['clean first, dirty second', [CLEAN, DIRTY_ANSWER], false],
  ['dirty first, clean second', [DIRTY_ANSWER, CLEAN], true],
  ['a probe that fails outright', [BROKEN], true],
]) {
  test(`remind Step 1 asks the tree once — ${name}`, () => {
    // Arrange: a checker-less run over a git whose successive status answers
    // contradict each other. The counter lives outside the harness directory,
    // which the run deletes on its way out.
    const probeDir = mkdtempSync(resolve(tmpdir(), 'remind-probe-'));
    const counter = resolve(probeDir, 'status-count');
    try {
      const seen = runStep1((repo, git, rootDir) => {
        commitBase(repo, git);
        gitShim(rootDir, answers, counter);
      });

      // Assert: exactly one tree question was asked, and the answer it gave governs
      // both halves. A second read is the defect, not an implementation detail —
      // whichever answer it returned, one of the two would be describing a tree the
      // other contradicts.
      assert.equal(readFileSync(counter, 'utf8').trim(), '1', 'the tree was asked more than once');
      assert.equal(seen.dirty === 'dirty', expectDirty, 'DIRTY reports the same answer the classification used');
      if (expectDirty) {
        assert.equal(seen.hasCode, 'true', 'a dirty or unverifiable tree owes both planes');
        assert.equal(seen.codeReview, 'false', 'and carries no verdict');
        assert.equal(seen.docReview, 'false', 'and carries no verdict');
        assert.equal(seen.precommit, 'false', 'and carries no verdict');
      } else {
        assert.equal(seen.hasCode, 'false', 'a clean answer classifies the tree as clean — the negative control');
        assert.equal(seen.hasDoc, 'false', 'both planes, from the same one answer');
      }
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });
}

test('remind Step 1 abandons a checker that outruns AUTO_LOOP_DERIVE_TIMEOUT', () => {
  // Arrange: a checker that would answer correctly, eventually. /remind is
  // interactive, so the bound matters more than the answer. A harness-local
  // `timeout` shim pins which ladder arm runs, instead of leaving that to whatever
  // the host happens to have installed.
  const seen = runStep1(
    (repo, git, rootDir) => {
      dirtyTree(repo, git);
      fakeChecker(repo, 'setTimeout(() => process.stdout.write("{}"), 9000);\n');
      const shim = resolve(rootDir, 'bin/timeout');
      writeFileSync(shim, '#!/bin/sh\nsecs="$1"; shift\n"$@" &\np=$!\n(sleep "$secs"; kill -9 $p 2>/dev/null) &\nw=$!\nwait $p; rc=$?\nkill $w 2>/dev/null\nexit $rc\n');
      execFileSync('chmod', ['+x', shim]);
    },
    { env: { AUTO_LOOP_DERIVE_TIMEOUT: '1' } },
  );

  assert.equal(seen.hasCode, 'true', 'the timed-out checker must land in the git fallback, which sees the dirty tree');
  assert.ok(seen.elapsedMs < 6000, `Step 1 took ${seen.elapsedMs}ms; the timeout ladder is not bounding it`);
});

// A pin that selects rows by prefix is not a pin on the table: rounds 31 and doc 7
// both defeated one by ADDING a contradicting row the filter never selected, leaving
// the chosen rows byte-identical. Every table pin below goes through this instead —
// it slices from the header to the table's own terminating blank line and returns
// every data row in order, so an added, removed or reordered row changes the array.
// Round 32: closing the first table is not closing the table. A SECOND complete table
// under the same header lands after the terminating blank line and outside every slice,
// so the header is required to be unique before anything is compared.
function tableRows(body, header) {
  const at = body.indexOf(header);
  assert.notEqual(at, -1, `the table headed "${header}" is gone`);
  assert.equal(
    body.split(header).length - 1, 1,
    `"${header}" heads more than one table; a duplicate publishes a second contract no pin selects`,
  );
  return body
    .slice(at)
    .split('\n\n')[0]
    .split('\n')
    .slice(2)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// The seven fields Step 1 reads out of `review-state.js check --format=json`:
// per plane, the change flag, the verdict, and (for the two review planes) the
// noted flag. The answer is accepted all-or-none.
const CHECKER_FIELDS = [
  ['code_review', 'dirty'], ['doc_review', 'dirty'],
  ['code_review', 'passed'], ['doc_review', 'passed'], ['precommit', 'passed'],
  ['code_review', 'noted'], ['doc_review', 'noted'],
];

// Every read field `true`-shaped where visible, so a half-accepted answer shows:
// the git fallback on a dirty tree reports every verdict `false` and both planes
// open, while this answer closes everything.
function fullAnswer() {
  const plane = () => ({ noted: true, dirty: false, digest_match: true, verdict: 'pass', rounds: 0, passed: true, owed: false });
  return { code_review: plane(), doc_review: plane(), precommit: plane() };
}

for (const [plane, field] of CHECKER_FIELDS) {
  test(`remind Step 1 refuses a checker answer missing ${plane}.${field} rather than mixing policies`, () => {
    // Arrange: valid JSON, six of the seven fields. Accepting it would leave one
    // empty and silently mix the checker's answer with the fallback's — so each
    // field is dropped in turn, since a condition that forgot one term still
    // rejects the rest.
    const answer = fullAnswer();
    delete answer[plane][field];
    const seen = runStep1((repo, git) => {
      dirtyTree(repo, git);
      fakeChecker(repo, `process.stdout.write(JSON.stringify(${JSON.stringify(answer)}));\n`);
    });

    assert.equal(seen.codeReview, 'false', 'a partial answer must be discarded whole, not read field by field');
    assert.equal(seen.hasCode, 'true', 'the git fallback, not the half-accepted answer, classified the tree');
  });

  test(`remind Step 1 refuses a checker answer whose ${plane}.${field} is a string, not a boolean`, () => {
    // jq's type check is the clause under test: `"true"` stringifies to the same
    // four characters a boolean does, so a shape-blind read accepts it — and with
    // it any malformed producer.
    const answer = fullAnswer();
    answer[plane][field] = String(answer[plane][field]);
    const seen = runStep1((repo, git) => {
      dirtyTree(repo, git);
      fakeChecker(repo, `process.stdout.write(JSON.stringify(${JSON.stringify(answer)}));\n`);
    });

    assert.equal(seen.codeReview, 'false', 'a non-boolean field rejects the whole answer');
    assert.equal(seen.hasCode, 'true', 'and the run falls back to git, which sees the dirty tree');
  });
}

for (const plane of ['code_review', 'doc_review', 'precommit']) {
  test(`remind Step 1 refuses a checker answer with the ${plane} plane missing entirely`, () => {
    const answer = fullAnswer();
    delete answer[plane];
    const seen = runStep1((repo, git) => {
      dirtyTree(repo, git);
      fakeChecker(repo, `process.stdout.write(JSON.stringify(${JSON.stringify(answer)}));\n`);
    });

    assert.equal(seen.precommit, 'false', 'a missing plane rejects the whole answer');
    assert.equal(seen.hasCode, 'true', 'and the git fallback classified the tree');
  });
}

test('remind Step 1 accepts a complete checker answer', () => {
  // Positive control for the malformed-answer guards: same fake-checker mechanism,
  // all seven fields boolean, so the guards cannot pass by rejecting everything.
  const answer = fullAnswer();
  answer.doc_review.dirty = true;
  answer.doc_review.passed = false;
  answer.doc_review.noted = false;
  answer.precommit.passed = false;
  const seen = runStep1((repo, git) => {
    dirtyTree(repo, git);
    fakeChecker(repo, `process.stdout.write(JSON.stringify(${JSON.stringify(answer)}));\n`);
  });

  assert.equal(seen.hasCode, 'false', 'the checker answer must win over the git fallback on this dirty tree');
  assert.equal(seen.hasDoc, 'true', 'per-plane change flags come from the answer');
  assert.equal(seen.codeReview, 'true', 'a checker verdict is the one thing that can close a gate here');
  assert.equal(seen.docNoted, 'false', 'the noted flags ride the same answer');
});

test('remind Step 1 degrades when the real checker has no repository to answer about', () => {
  // The installed checker dies outside a repository — its digest has no tree to
  // bind to — and the run must degrade rather than borrow the three PASSes
  // sitting in the slots. An unverifiable tree plus unreachable state is the
  // both-planes-owed case, which is what leaves a finding.
  const seen = runStep1((repo, git, rootDir) => {
    commitBase(repo, git);
    installChecker(repo);
    for (const plane of ['code_review', 'doc_review', 'precommit']) noteGate(repo, rootDir, plane, 'pass');
    rmSync(resolve(repo, '.git'), { recursive: true, force: true });
  });

  assert.equal(seen.codeReview, 'false', 'the slots hold PASSes, and none of them was borrowed');
  assert.equal(seen.docReview, 'false', 'none of the three');
  assert.equal(seen.precommit, 'false', 'none of the three');
  assert.equal(seen.codeNoted, 'false', 'no noted flag either — the degraded path has no source for it');
  assert.equal(seen.hasCode, 'true', 'an unverifiable tree owes both planes');
  assert.equal(seen.hasDoc, 'true', 'both planes');
});

test('remind Step 1 fences the whole GIT_* namespace, not a named subset', () => {
  // Arrange: GIT_CEILING_DIRECTORIES was not in the original six-name fence. From a
  // subdirectory it stops repository discovery, and git exits non-zero.
  const seen = runStep1(
    (repo, git) => {
      commitBase(repo, git);
      mkdirSync(resolve(repo, 'sub'));
    },
    // The ceiling must name the repository root itself: that is the directory the
    // upward search would otherwise accept, and a broader ceiling changes nothing.
    { subdir: 'sub', env: (repo) => ({ GIT_CEILING_DIRECTORIES: repo }) },
  );

  // Assert on a CLEAN tree, because that is the only state the two outcomes disagree
  // about: fenced, git answers "nothing uncommitted" and neither plane opens;
  // unfenced, discovery fails and the fail-closed branch opens both.
  assert.equal(seen.hasCode, 'false', 'a fenced probe sees the real, clean tree');
  assert.equal(seen.hasDoc, 'false', 'an unfenced ceiling would blind the probe and open both planes');
  assert.equal(seen.branch, 'main', 'the fenced rev-parse still resolves the real branch');
});

test('remind Step 1 pins the fence to a dynamic GIT_* enumeration, not a named list', () => {
  // A behavioural test cannot reach this: any named list long enough to cover the
  // variables a test happens to set passes every case above, while still leaving
  // GIT_INDEX_FILE, GIT_CONFIG_COUNT and the rest able to redirect the read. The
  // property that matters is that the list is never written down at all.
  const block = step1Block();
  const fence = block.split('\n').find((l) => l.includes('_remind_git()'));

  // Pinned as a whole line, normalized only for whitespace. A regex over its parts
  // is not enough: `for v in ${!GIT_*}; do case "$v" in GIT_DIR) unset "$v";; esac; done`
  // enumerates dynamically, unsets "$v", names nothing after `in` — and still leaves
  // GIT_INDEX_FILE and the config channels live. The fence is four tokens long and
  // has no reason to vary, so the contract is the text itself.
  assert.equal(
    fence.replace(/\s+/g, ' ').trim(),
    `_remind_git() ( for v in $(env | sed -n 's/^\\(GIT_[A-Za-z0-9_]*\\)=.*/\\1/p'); do unset "$v"; done; git -C "$PWD" "$@" )`,
    'the fence must unset every enumerated name unconditionally, in a subshell, with -C "$PWD"',
  );

  // And the enumeration must stay portable. `${!GIT_*}` reads as the obvious spelling of
  // "every GIT_ name" and is what this fence used to say, but it is a bash extension:
  // under zsh it is a hard `bad substitution` that takes out every read in the block at
  // once. Scoped to executable lines — the comment above the fence names the expansion
  // in order to explain why it is banned, and a check that cannot tell prose from code
  // would forbid documenting the ban.
  const code = block
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  assert.doesNotMatch(
    code,
    /\$\{!\w+\*\}/,
    'prefix-name expansion is bash-only — the block runs under the session shell, which is zsh',
  );
});

const HAVE_ZSH = (() => {
  try {
    execFileSync('zsh', ['-c', 'exit 0'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('remind Step 1 resolves identically under zsh and bash', { skip: !HAVE_ZSH }, () => {
  // The block is not a script with a shebang — it is a fenced snippet the model pastes
  // into a Bash tool call, so the shell that runs it is whatever the session provides.
  // Every other case here runs it under bash, which is why a bash-only expansion sat in
  // the fence undetected: under zsh `${!GIT_*}` is a hard `bad substitution` that fails
  // the fence subshell, and with it every read in the block — a provably clean tree then
  // reports dirty (the error text lands in TREE through its own `2>&1`), BRANCH empties,
  // and detection 4 can never fire again. Both directions are asserted below: the clean
  // tree must read clean under zsh, and the branch must still resolve.
  const fixture = (repo, git) => commitBase(repo, git);
  const underBash = runStep1(fixture, { shell: 'bash' });
  const underZsh = runStep1(fixture, { shell: 'zsh' });

  assert.deepEqual(
    { hasCode: underZsh.hasCode, hasDoc: underZsh.hasDoc, branch: underZsh.branch, dirty: underZsh.dirty },
    { hasCode: underBash.hasCode, hasDoc: underBash.hasDoc, branch: underBash.branch, dirty: underBash.dirty },
    'the block must resolve the same four facts under either shell',
  );
  // Pinned absolutely as well, so the case cannot pass by both shells failing alike:
  // a broken fence degrades to hasCode/hasDoc true, branch "none" and dirty "dirty",
  // which is self-consistent across two broken runs and would satisfy the compare above.
  assert.equal(underZsh.branch, 'main', 'zsh: the fenced rev-parse must resolve the real branch');
  assert.equal(underZsh.dirty, '', 'zsh: a committed tree must read clean, not error-text-as-dirty');
  assert.equal(underZsh.hasCode, 'false', 'zsh: a clean tree opens no plane');
});

test('remind Step 1 fences the reads that report the branch and the dirty flag', () => {
  // Arrange: a second Git environment channel, and one aimed at the two reads that
  // are not plane classification. GIT_DIR redirects every unfenced git command at a
  // decoy repository — whose branch name is the discriminator, since a fenced read
  // reports the real one and an unfenced read reports the decoy's.
  const seen = runStep1(
    (repo, git, rootDir) => {
      commitBase(repo, git);
      writeFileSync(resolve(repo, 'app.js'), 'module.exports = 4;\n');
      const decoy = resolve(rootDir, 'decoy');
      mkdirSync(decoy);
      const denv = harnessEnv(rootDir);
      execFileSync('git', ['init', '-q', '-b', 'decoy-branch', decoy], { env: denv });
      const dgit = (...a) => execFileSync('git', ['-C', decoy, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...a], { env: denv });
      dgit('config', 'user.email', 'harness@sd0x.invalid');
      dgit('config', 'user.name', 'harness');
      writeFileSync(resolve(decoy, 'decoy.txt'), 'decoy\n');
      dgit('add', '-A');
      dgit('commit', '-qm', 'decoy');
    },
    { env: (repo) => ({ GIT_DIR: resolve(repo, '..', 'decoy', '.git') }) },
  );

  assert.equal(seen.branch, 'main', 'BRANCH must come from the real repository, not the redirected one');
  assert.equal(seen.dirty, 'dirty', 'DIRTY must report the real working tree');
  assert.equal(seen.hasCode, 'true', 'the real tree is dirty, so both planes are owed');
  assert.equal(seen.hasDoc, 'true', 'the real tree is dirty, so both planes are owed');
});

test('remind Step 1 sees a dirty submodule that is configured to hide itself', () => {
  // Arrange: `submodule.<name>.ignore=all` suppresses the superproject's own record
  // of the submodule, so a plain `git status` prints nothing and exits 0 — the exact
  // shape this branch reads as "provably clean". `tree-digest.js` handles the same
  // case; the fallback has to as well, or /remind reports All Clear over real work.
  const seen = runStep1((repo, git, rootDir) => {
    const inner = resolve(rootDir, 'inner');
    mkdirSync(inner);
    const env = harnessEnv(rootDir);
    execFileSync('git', ['init', '-q', '-b', 'main', inner], { env });
    const igit = (...a) => execFileSync('git', ['-C', inner, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...a], { env });
    igit('config', 'user.email', 'harness@sd0x.invalid');
    igit('config', 'user.name', 'harness');
    writeFileSync(resolve(inner, 'lib.js'), 'module.exports = 1;\n');
    igit('add', '-A');
    igit('commit', '-qm', 'inner base');

    commitBase(repo, git);
    git('-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', inner, 'vendor');
    git('config', '-f', '.gitmodules', 'submodule.vendor.ignore', 'all');
    git('add', '-A');
    git('commit', '-qm', 'add submodule');
    // The only uncommitted work in the tree, and it is inside the hidden submodule.
    writeFileSync(resolve(repo, 'vendor/lib.js'), 'module.exports = 2;\n');
  });

  assert.equal(seen.hasCode, 'true', 'a hidden-but-dirty submodule must not read as a clean tree');
  assert.equal(seen.hasDoc, 'true', 'and the degraded path owes both planes');
});

test('remind Step 1 run from a subdirectory resolves the checker at the repository root', () => {
  // Anchoring: the checker is installed at the root and the run happens in `sub/`.
  // Resolved relative to the CWD there is no checker at all, so the run would
  // degrade and read no verdict — over a root whose checker answers PASS. The
  // passing verdict is therefore the whole evidence of anchoring, and it also
  // proves the `cd "$ROOT"` on the invocation: run from `sub/`, the checker would
  // otherwise answer about whatever repository the CWD resolves to.
  const seen = runStep1(
    (repo, git, rootDir) => {
      commitBase(repo, git);
      installChecker(repo);
      noteGate(repo, rootDir, 'precommit', 'pass');
      mkdirSync(resolve(repo, 'sub'));
    },
    { subdir: 'sub' },
  );

  assert.equal(seen.precommit, 'true', 'the root-installed checker answered, binding the note to the clean tree');
  assert.equal(seen.hasCode, 'false', 'and classified the clean tree per plane');
});

test('remind Step 1 clears every dangerous GIT_* channel, not just the first one', () => {
  // Two channels at once, each fatal on its own: a ceiling that blinds discovery from
  // `sub/`, and a GIT_DIR pointing at a decoy. A fence that enumerates the namespace
  // dynamically but stops after one iteration passes every single-variable fixture —
  // this is the case that requires it to finish the loop.
  const seen = runStep1(
    (repo, git, rootDir) => {
      commitBase(repo, git);
      mkdirSync(resolve(repo, 'sub'));
      const decoy = resolve(rootDir, 'decoy');
      mkdirSync(decoy);
      const denv = harnessEnv(rootDir);
      execFileSync('git', ['init', '-q', '-b', 'decoy-branch', decoy], { env: denv });
      const dgit = (...a) => execFileSync('git', ['-C', decoy, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...a], { env: denv });
      dgit('config', 'user.email', 'harness@sd0x.invalid');
      dgit('config', 'user.name', 'harness');
      writeFileSync(resolve(decoy, 'decoy.txt'), 'decoy\n');
      dgit('add', '-A');
      dgit('commit', '-qm', 'decoy');
      writeFileSync(resolve(decoy, 'decoy.txt'), 'dirty\n');
    },
    {
      subdir: 'sub',
      env: (repo) => ({
        GIT_CEILING_DIRECTORIES: repo,
        GIT_DIR: resolve(repo, '..', 'decoy', '.git'),
      }),
    },
  );

  assert.equal(seen.branch, 'main', 'a surviving GIT_DIR would report the decoy branch');
  assert.equal(seen.hasCode, 'false', 'a surviving ceiling would fail discovery and open both planes');
  assert.equal(seen.dirty, '', 'the real tree is clean; the decoy is the dirty one');
});

test('remind Step 1 opens both planes when git cannot answer at all', () => {
  // Arrange: a tree whose repository is gone. An empty record stream is then
  // indistinguishable from a clean tree, which is exactly the confusion that
  // would let /remind report All Clear over unreviewed work.
  const seen = runStep1((repo, git) => {
    commitBase(repo, git);
    rmSync(resolve(repo, '.git'), { recursive: true, force: true });
  });

  assert.equal(seen.hasCode, 'true', 'an unprovable tree owes the code plane');
  assert.equal(seen.hasDoc, 'true', 'an unprovable tree owes the doc plane');
});

test('remind Step 1 completes its own cleanup under a caller that set -e', () => {
  // A failed command substitution inside an assignment aborts a `set -e` shell. The
  // non-repo path is where every git read fails at once, so a step that leaned on
  // those assignments succeeding would die before its `unset -f` line — leaving the
  // caller's shell carrying two functions it never defined.
  const seen = runStep1(
    (repo, git) => {
      commitBase(repo, git);
      rmSync(resolve(repo, '.git'), { recursive: true, force: true });
    },
    { shellPrelude: 'set -e\n' },
  );

  assert.equal(seen.hasCode, 'true', 'the step ran to completion and still fails closed');
  assert.equal(seen.branch, 'none', 'an unresolvable branch is empty, not a fatal error');
  assert.equal(seen.fnLeft, '', 'the cleanup line ran, so the caller keeps no function it never defined');
});

test('remind Step 1 survives a malformed checker answer under set -e', () => {
  // Nonempty but unparseable: `jq` exits nonzero inside the helper, and an
  // unguarded command substitution would abort the caller's shell before the
  // fallback — the branch whose whole job is to answer when the checker cannot.
  const seen = runStep1(
    (repo, git) => {
      dirtyTree(repo, git);
      fakeChecker(repo, 'process.stdout.write("{not json at all");\n');
    },
    { shellPrelude: 'set -e\n' },
  );

  assert.equal(seen.hasCode, 'true', 'the shell survived and the git fallback classified the tree it found');
  assert.equal(seen.precommit, 'false', 'a discarded answer leaves no verdict behind it');
  // This fixture is the one where both helpers get defined, so it is where a
  // cleanup line that forgot one of them shows up.
  assert.equal(seen.fnLeft, '', 'every helper the step defined is gone, not just the first');
});

// Default bash 5 does not carry errexit into a command substitution; `shopt -s
// inherit_errexit` and `--posix` do. A guard that only holds in the first mode is
// not a guard, so the corrupt-slot case runs in both.
for (const [mode, prelude] of [['set -e', 'set -e\n'], ['set -e + inherit_errexit', 'set -e\nshopt -s inherit_errexit\n']]) {
  test(`remind Step 1 is inert to a corrupt state slot under ${mode}`, () => {
    const seen = runStep1(
      (repo, git, rootDir) => {
        // Clean tree, so nothing else can be the reason the run survives.
        commitBase(repo, git);
        installChecker(repo);
        noteGate(repo, rootDir, 'precommit', 'pass');
        // Tear the slot mid-write, the way a concurrent producer would. The
        // checker decodes it as not-noted; nothing here parses it at all.
        const stateRoot = resolve(rootDir, 'home', '.cache', 'sd0x-dev-flow', 'state');
        const keys = readdirSync(stateRoot);
        assert.equal(keys.length, 1, 'exactly one repo key expected under the harness HOME');
        writeFileSync(resolve(stateRoot, keys[0], 'precommit.json'), '{"verdict": "pa');
      },
      { shellPrelude: prelude },
    );

    assert.equal(seen.precommit, 'false', 'an undecodable slot is no verdict');
    assert.equal(seen.hasCode, 'false', 'the checker still answered — a torn slot degrades that slot, not the run');
    assert.equal(seen.fnLeft, '', 'a slot the step never parses cannot abort it: cleanup still ran');
  });
}

test('remind Step 1 on a clean tree opens neither plane', () => {
  // Negative control for every classification case above: without it they would
  // pass on a block that unconditionally set both flags true.
  const seen = runStep1(commitBase);

  assert.equal(seen.hasCode, 'false', 'a clean tree owes the code plane nothing');
  assert.equal(seen.hasDoc, 'false', 'a clean tree owes the doc plane nothing');
  assert.equal(seen.dirty, '', 'DIRTY must stay empty on a clean tree — the negative control for the redirect test');
});

test('remind Step 1 treats a chatty-but-successful git as a dirty plane, never as clean', () => {
  // Arrange: git that warns on stderr and exits zero — a stale index extension, a
  // deprecated config key, an advice block. The probes fold stderr into the answer
  // (`2>&1`), so the warning reads as output and both planes are owed. That is the
  // fail-closed direction and the point of the test: the alternative reading of a
  // successful-but-noisy git is "clean tree", which would hide unreviewed work.
  const seen = runStep1((repo, git, rootDir) => {
    commitBase(repo, git);
    const shim = resolve(rootDir, 'bin/git');
    writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "warning: stale index extension, ignoring" >&2\nexec ${REAL_GIT} "$@"\n`);
    execFileSync('chmod', ['+x', shim]);
  });

  assert.equal(seen.hasCode, 'true', 'a warning must not be read as an empty, clean answer');
  assert.equal(seen.hasDoc, 'true', 'both planes are owed when the answer cannot be trusted to be empty');
});

test('remind Step 1 without the checker owes BOTH planes for a doc-only change', () => {
  // The degraded path does not classify — only the checker does, by full-path
  // suffix over the whole repository. An untracked file also proves `-uall` is
  // load-bearing: with untracked files suppressed this tree reads as clean.
  const seen = runStep1((repo, git) => {
    commitBase(repo, git);
    writeFileSync(resolve(repo, 'tutorial.mdx'), '# Tutorial\n');
  });

  assert.equal(seen.hasDoc, 'true', 'an untracked doc file must open the doc plane');
  assert.equal(seen.hasCode, 'true', 'the degraded path over-reminds rather than guessing a plane');
});

test('remind Step 1 without the checker is not fooled by a directory whose name ends in .md', () => {
  // A pathspec-based classifier reads `notes.md/app.js` by the pattern that matched,
  // not by the leaf suffix. The whole-tree probe has no pattern to be fooled by, and
  // this case pins that it stays that way.
  const seen = runStep1((repo, git) => {
    mkdirSync(resolve(repo, 'notes.md'));
    writeFileSync(resolve(repo, 'notes.md/app.js'), 'module.exports = 1;\n');
    writeFileSync(resolve(repo, 'guide.md'), '# Guide\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    writeFileSync(resolve(repo, 'notes.md/app.js'), 'module.exports = 2;\n');
  });

  assert.equal(seen.hasCode, 'true', 'a .js under a .md-named directory owes the code plane');
  assert.equal(seen.hasDoc, 'true', 'and the degraded path owes the other plane with it');
});

test('remind Step 1 run from a subdirectory still sees a change at the repository root', () => {
  // The measured defect this replaced: an ordinary pathspec is relative to the CWD,
  // so from `sub/` a `-- '*.md'` probe could not see a dirty root-level guide.md
  // while a negative-only probe still reported it — a doc-only change reading as
  // code-only. `-C "$PWD"` alone does not fix that; not classifying does.
  const seen = runStep1(
    (repo, git) => {
      commitBase(repo, git);
      mkdirSync(resolve(repo, 'sub'));
      writeFileSync(resolve(repo, 'guide.md'), '# Guide, revised\n');
    },
    { subdir: 'sub' },
  );

  assert.equal(seen.hasDoc, 'true', 'a root-level doc change is visible from a subdirectory');
  assert.equal(seen.hasCode, 'true', 'and it is never reported as a code-only change');
});

test('remind Step 1 without the checker reports BOTH planes for a cross-plane rename', () => {
  // A staged rename whose two sides sit on different planes — the case a per-plane
  // classifier had to get right in two places at once, and the one the whole-tree
  // probe answers without looking at either side.
  const seen = runStep1((repo, git) => {
    writeFileSync(resolve(repo, 'a.md'), '# A\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('mv', 'a.md', 'b.js');
  });

  assert.equal(seen.hasCode, 'true', 'the added .js side owes the code plane');
  assert.equal(seen.hasDoc, 'true', 'the deleted .md side owes the doc plane');
});

test('remind Step 1 without the checker classifies a path containing quotes and spaces', () => {
  const seen = runStep1((repo, git) => {
    commitBase(repo, git);
    writeFileSync(resolve(repo, 'odd "release" notes.md'), '# Notes\n');
  });

  assert.equal(seen.hasDoc, 'true', 'a path git renders with quotes and escapes is still a dirty tree');
  assert.equal(seen.hasCode, 'true', 'the degraded path owes both planes');
});

test('remind Step 1 executable lines reach the state only through the checker', () => {
  // Arrange: strip comments so an explanatory mention of a path or field cannot
  // satisfy — or trip — this guard.
  const code = step1Block().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  // Assert (negative): the slot is never located or parsed by hand. Its directory
  // is keyed by a non-contractual hash, so any line that reconstructs the path or
  // reads a slot file is reading state the contract says only the checker binds.
  assert.ok(!/\.cache\/sd0x-dev-flow|sd0x-dev-flow\/state/.test(code), 'the state directory is being located by hand — its key is non-contractual');
  assert.ok(!/sha256|createHash|shasum/.test(code), 'the repo key is being re-derived — it is non-contractual by design');
  assert.ok(!/(code_review|doc_review|precommit)\.json/.test(code), 'a slot file is read directly instead of through the checker');
  assert.ok(!/\.claude_review_state\.json/.test(code), 'the retired repo-local state file is back');

  // Assert (positive control): the checker is still resolved (installed copy
  // first) and still invoked from the repository root — the guards above cannot
  // pass by deleting the state read entirely.
  assert.match(code, /CHECKER="\$ROOT\/\.claude\/scripts\/review-state\.js"/, 'the installed checker path is resolved first');
  assert.match(code, /\[ -f "\$CHECKER" \] \|\| CHECKER="\$ROOT\/scripts\/review-state\.js"/, 'with the repo copy as the fallback');
  assert.match(code, /check --format=json/, 'and asked for the JSON rendering Step 1 parses');
  assert.match(code, /cd "\$ROOT" &&/, 'from the repository root, so the checker answers about the anchored tree');
});

// The three surfaces that publish the detection set: the skill the model executes,
// the reference it reads, and the spec that says what was designed. They are written
// by hand, in three tables, and the failure they produce when they disagree is a
// model inventing a condition — so the set is pinned by meaning, not by label. Each
// row carries what its condition must mention and what it must not: a retired
// detection can come back inside an existing row's condition just as easily as under
// a new name, and `state-drift` is the one that did.
const LIVE_DETECTIONS = [
  {
    label: /code[- ](changed|no)/i, id: 'code-no-review', conjunction: true,
    condition: [/has_code\s*=\s*true/i, /code_review\s*=\s*false/i],
  },
  {
    label: /doc[- ](changed|no)/i, id: 'doc-no-review', conjunction: true,
    condition: [/has_doc\s*=\s*true/i, /doc_review\s*=\s*false/i],
  },
  {
    label: /precommit/i, id: 'review-no-precommit', conjunction: true,
    condition: [/code_review\s*=\s*true/i, /precommit\s*=\s*false/i],
  },
  {
    // The one row whose polarity is an equality rather than a `=true`/`=false`: the
    // pin has to be the positive form itself, since naming the three tokens leaves
    // "`BRANCH` is *not* `main` or `master`" matching every one of them.
    label: /main[- ]branch/i, id: 'main-branch',
    condition: [/branch/i, /(is|=)\s*`?main`?\s*(or|\/)\s*`?master`?/i],
  },
  {
    // Row 5's `or` is a genuine disjunction over the two planes — the finding is
    // aggregated, firing once and naming every never-noted dirty plane — while
    // each side stays a conjunction of its two facts.
    label: /dirty|never[- ]noted/i, id: 'dirty-never-noted', conjunction: true, disjunction: true,
    condition: [/has_code\s*=\s*true/i, /code_noted\s*=\s*false/i, /has_doc\s*=\s*true/i, /doc_noted\s*=\s*false/i],
  },
];

// The retired detections are recognizable by their conditions, not only by their
// names. Any row saying the stored state "says changes" has resurrected state-drift,
// and any row keyed on a repo-local state file's existence has resurrected
// dirty-no-state — whatever either is called and whichever position it occupies.
const RETIRED_CONDITIONS = [/says? changes/i, /state[- ]drift/i, /mirror/i, /no state file/i, /state_file_exists/i];

// A detection states when it fires. Every live condition is written in the positive,
// and a negation inside one inverts what the model looks for while every field name
// the row mentions stays put — the failure a token-presence pin cannot see.
const NEGATED_CONDITION = /\b(not|never|unless|isn'?t|aren'?t)\b|≠|!==?/i;

// Rows 1-3 fire on two facts holding *together*; row 5 on either plane's pair.
// Naming the facts is not enough: "`HAS_CODE=true` or `CODE_REVIEW=false`" mentions
// the same two and fires on a reviewed tree with an unreviewed sibling plane, or on
// nothing at all. Row 4's `main` **or** `master` is a genuine disjunction over one
// fact, and row 5's `or` spans its two plane-pairs — so the pin is per-row.
const CONJUNCTION = /\+|\band\b/i;
const DISJUNCTION = /\bor\b|\|\|/i;

// All three surfaces now speak the same vocabulary — the shell variables Step 1
// sets from the checker's per-plane booleans. It is an EXACT set: a row that adds
// a fact is as wrong as one that drops it, and `HAS_CODE=true + CODE_REVIEW=false
// + PRECOMMIT=true` (which asks for a review only after precommit already passed)
// satisfies every presence, polarity and conjunction pin while inverting when the
// row fires.
const FACTS = [
  ['has_code=true', 'code_review=false'],
  ['has_doc=true', 'doc_review=false'],
  ['code_review=true', 'precommit=false'],
  [],
  ['code_noted=false', 'doc_noted=false', 'has_code=true', 'has_doc=true'],
];

const IDENTS = [
  ['code_review', 'has_code'],
  ['doc_review', 'has_doc'],
  ['code_review', 'precommit'],
  ['branch'],
  ['code_noted', 'doc_noted', 'has_code', 'has_doc'],
];

// `rules/auto-loop-project.md` also contains "auto-loop", and it is a different file
// with a different (user-owned) contract — so the mapping column is compared as an
// exact target, not searched for a substring.
const RULE_TARGETS = ['rules/auto-loop.md', 'rules/auto-loop.md', 'rules/auto-loop.md', 'rules/git-workflow.md', 'CLAUDE.md'];

function factsIn(cell) {
  return [...cell.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(true|false)\b/g)]
    .map((m) => `${m[1].toLowerCase()}=${m[2].toLowerCase()}`)
    .sort();
}

// Equality tokens are not the whole condition. "`HAS_CODE=true` + `CODE_REVIEW=false`
// + `PRECOMMIT` already passed" adds a third predicate in prose, leaves the extracted
// pairs untouched, and asks for a code review only once precommit has passed — the
// owed-review state inverted. So the identifiers a row MENTIONS are compared too.
const GATE_IDENTIFIERS = /\b(has_code|has_doc|code_review|doc_review|precommit|code_noted|doc_noted|branch|dirty)\b/gi;

function identsIn(cell) {
  return [...new Set(
    [...cell.matchAll(GATE_IDENTIFIERS)].map((m) => m[0].toLowerCase()),
  )].sort();
}

// Enumerating the vocabulary is an arms race the enumerator loses: `pre-commit`
// names the same gate as `PRECOMMIT` and matches neither the fact regex nor the
// identifier regex, so "`HAS_CODE=true` + `CODE_REVIEW=false` + `pre-commit`
// already passed" inverts when the row fires while every semantic pin stays green
// (round 20). These five cells are deliberately stable prose, so the condition is
// compared as an EXACT normalized string. The semantic pins above are kept for the
// failure message they give — this one says only "it changed", they say how.
function normalizeCell(cell) {
  return cell.replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

const DETECTION_SURFACES = [
  {
    path: 'skills/remind/SKILL.md',
    heading: '### Step 2: Detection → Rule Mapping',
    labelCol: 1, conditionCol: 2, actionCol: 3,
    exact: [
      'HAS_CODE=true + CODE_REVIEW=false',
      'HAS_DOC=true + DOC_REVIEW=false',
      'CODE_REVIEW=true + PRECOMMIT=false',
      'BRANCH is main or master',
      '(HAS_CODE=true + CODE_NOTED=false) or (HAS_DOC=true + DOC_NOTED=false)',
    ],
    targets: RULE_TARGETS,
  },
  {
    path: 'skills/remind/references/detection-rules.md',
    heading: '## Detection → Rule Mapping',
    labelCol: 1, conditionCol: 3, actionCol: 4,
    exact: [
      'HAS_CODE=true + CODE_REVIEW=false',
      'HAS_DOC=true + DOC_REVIEW=false',
      'CODE_REVIEW=true + PRECOMMIT=false',
      "BRANCH (Step 1's fenced git rev-parse --abbrev-ref HEAD) = main or master — a detached HEAD reads HEAD and matches neither",
      '(HAS_CODE=true + CODE_NOTED=false) or (HAS_DOC=true + DOC_NOTED=false) — **one aggregated finding** naming every such plane',
    ],
    targets: RULE_TARGETS,
  },
  {
    path: 'docs/features/remind/2-tech-spec.md',
    heading: '#### Detection Rules',
    labelCol: 1, conditionCol: 3, actionCol: 4,
    exact: [
      'HAS_CODE=true + CODE_REVIEW=false',
      'HAS_DOC=true + DOC_REVIEW=false',
      'CODE_REVIEW=true + PRECOMMIT=false',
      'BRANCH = main/master',
      '(HAS_CODE=true + CODE_NOTED=false) or (HAS_DOC=true + DOC_NOTED=false)',
    ],
    // The correction column, not a rule path: each row's dispatch, anchored so a
    // swapped command cannot hide inside surrounding prose.
    targets: [/^`\/codex-review-fast`$/, /^`\/codex-review-doc`$/, /^`\/precommit`$/, /feature branch/, /^Load `CLAUDE\.md` § Required Checks/],
  },
];

for (const surface of DETECTION_SURFACES) {
  const { path, heading, labelCol, conditionCol, actionCol, exact, targets } = surface;

  test(`${path} publishes exactly the five live detections, by meaning`, () => {
    // Arrange: the numbered rows of THIS file's detection table — scoped to the
    // section, since every one of these files has other numbered tables.
    const body = readFileSync(resolve(root, path), 'utf8');
    const from = body.indexOf(heading);
    assert.ok(from !== -1, `${path} no longer has the section "${heading}"`);
    const section = body.slice(from + heading.length).split(/\n#{2,4} /)[0];
    const rows = section
      .split('\n')
      .filter((l) => /^\| \d+ \|/.test(l))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));

    assert.equal(rows.length, 5, `${path} lists ${rows.length} detections, not 5`);
    assert.deepEqual(rows.map((r) => r[0]), ['1', '2', '3', '4', '5'], 'rows are numbered 1-5 with no gap');

    for (const row of rows) {
      for (const retired of RETIRED_CONDITIONS) {
        assert.ok(!retired.test(row[conditionCol]), `a row of ${path} carries a retired detection condition (${retired})`);
      }
    }

    // Assert: each row is the detection its position claims, and says the same thing
    // the other two surfaces say — the label identifies it, the condition carries its
    // polarity (`=true` / `=false`, not merely the field name), and the action column
    // names the rule or correction it dispatches. Token presence alone let a
    // condition be inverted and a correction be swapped while the test stayed green.
    rows.forEach((row, i) => {
      const { label, condition, conjunction, disjunction } = LIVE_DETECTIONS[i];
      assert.deepEqual(
        factsIn(row[conditionCol]), [...FACTS[i]].sort(),
        `row ${i + 1} of ${path} fires on a different set of facts than the other surfaces`,
      );
      assert.deepEqual(
        identsIn(row[conditionCol]), [...IDENTS[i]].sort(),
        `row ${i + 1} of ${path} names a gate its condition should not mention`,
      );
      assert.equal(
        normalizeCell(row[conditionCol]), exact[i],
        `row ${i + 1} of ${path} states its condition differently — these five cells are pinned verbatim`,
      );
      assert.match(row[labelCol], label, `row ${i + 1} of ${path} is not the detection this position publishes`);
      assert.ok(
        !NEGATED_CONDITION.test(row[conditionCol]),
        `row ${i + 1} of ${path} states its condition in the negative`,
      );
      for (const c of condition) {
        assert.match(row[conditionCol], c, `row ${i + 1} of ${path} states a different condition`);
      }
      if (conjunction) {
        assert.match(row[conditionCol], CONJUNCTION, `row ${i + 1} of ${path} no longer joins its facts`);
        if (!disjunction) {
          assert.ok(
            !DISJUNCTION.test(row[conditionCol]),
            `row ${i + 1} of ${path} fires on either fact alone, not on both together`,
          );
        }
      }
      const target = targets[i];
      if (typeof target === 'string') {
        assert.equal(row[actionCol].replace(/`/g, '').trim(), target, `row ${i + 1} of ${path} maps to a different file`);
      } else {
        assert.match(row[actionCol], target, `row ${i + 1} of ${path} dispatches something else`);
      }
    });
  });
}

test('every remind surface that describes a run ends at execution, not at output', () => {
  // Round 22: SKILL.md carried the executor contract while the spec's architecture
  // graph terminated at `Output: Findings + Corrections`, § 3.2 ended at "correction
  // commands", and the `--all` reference ended at "compliance status per rule". A
  // model following any of those three believes it completed the documented flow by
  // printing a command — which is the single failure this skill exists to correct.
  const spec = readFileSync(resolve(root, 'docs/features/remind/2-tech-spec.md'), 'utf8');
  const detection = readFileSync(resolve(root, 'skills/remind/references/detection-rules.md'), 'utf8');

  // The graph must continue past output, and must NOT redraw the lifecycle: round 22
  // drew the terminal outcomes here and round 23 found the drawing already diverged
  // from Step 4 (no edge for a lone detection 4 on a run the checker answered). A
  // diagram of a contract is a copy of the contract, so this one delegates instead.
  const graph = spec.slice(spec.indexOf('flowchart TD'), spec.indexOf('```', spec.indexOf('flowchart TD')));
  // Anchored as a whole line: mermaid chains links, so
  // `O --> X[...] --> Z[Stop after the report]` satisfies an unanchored match, adds
  // no line beginning with `X`, and uses none of the refused names (round 26). The
  // two assertions cover both shapes a successor can take.
  assert.match(
    graph,
    /^\s*O --> X\[Apply SKILL\.md § Step 4 lifecycle\]\s*$/m,
    'the architecture graph must end its final edge at the Step 4 delegation node',
  );
  assert.ok(
    !/All Clear|Degraded|detection 4/i.test(graph),
    'the architecture graph has grown its own copy of the terminal outcomes again',
  );
  // Refusing the three names is not the invariant — `X --> S[Stop after the report]`
  // reinstates exactly the defect this test exists to prevent while using none of
  // them (round 24). The invariant is structural: the delegating node is where the
  // graph ends, so it has no outgoing edge, whatever any successor were called.
  assert.doesNotMatch(
    graph,
    // Not an operator list — `o--o`, `x--x`, `<-->` and `~~~` all start with a
    // character no enumeration guessed, and each one gives `X` a successor. `X` is
    // declared on the incoming `O --> X[...]` edge, so any statement that BEGINS
    // with it is a second statement about a node that should have none.
    /^\s*X\b/m,
    'the delegating Step 4 node must be the graph boundary — it has acquired a successor',
  );
  assert.match(
    spec,
    /A picture of the lifecycle is a second copy of the lifecycle\./,
    'and the spec must say why the graph stops there',
  );
  assert.ok(
    !/DS --> O\n *```/.test(spec),
    'the architecture graph terminates at output again',
  );

  const ruleMode = spec.slice(spec.indexOf('### 3.2 Rule Reminder Mode'), spec.indexOf('### 3.3'));
  assert.match(
    ruleMode,
    /5\. \*\*Execute\*\*: hand off to `skills\/remind\/SKILL\.md` § Step 4/,
    'Rule Reminder Mode must hand off to the execution step rather than end at its output',
  );

  const allMode = detection.slice(detection.indexOf('## `--all` Mode Rule Loading'));
  assert.match(
    allMode,
    /6\. Execute: invoke every owed correction Skill in the same reply/,
    'the --all reference must end at execution, not at a compliance report',
  );
});

test('remind detection IDs are published once, in the reference surface', () => {
  // The reference is the surface that carries stable IDs; the other two use prose
  // labels for their audiences. Pinning the IDs here is what lets the prose differ
  // ("Main branch" vs "On main branch") without the set itself becoming ambiguous.
  const detection = readFileSync(resolve(root, 'skills/remind/references/detection-rules.md'), 'utf8');
  const ids = detection.split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => l.split('|')[2].trim().replace(/`/g, ''));

  assert.deepEqual(ids, LIVE_DETECTIONS.map((d) => d.id));

  // Doc round 6 counted the surfaces that assign a terminal outcome and found this one
  // the only one not closed: SKILL.md's Step 2 and Graceful Degradation tables and the
  // spec's degraded paragraph and output row are each exact-pinned, while the reference
  // carried its own “ends at Degraded” cell with only its detection IDs pinned. Round 31
  // then showed a prefix filter is not a table pin — a row keyed on anything but `Tree `
  // was simply not selected, so a contradicting row could be added beside the pinned two.
  // The table is sliced at its own boundaries and every data row is compared in order.
  const DEGRADED_TABLE_EXACT = [
    [
      '| Tree provably clean | All `false` | No **gate** row — no change flag, no verdict, no ',
      'noted flag |',
    ].join(''),
    [
      '| Tree dirty or unverifiable | All `false` | Rows 1 and 2; **rows 3 and 5 cannot** — 3 ',
      'triggers on `code_review.passed=true`, 5 on a noted flag, and the degraded path has neither |',
    ].join(''),
  ];
  const degradedRows = tableRows(detection, '| Degraded run | Verdicts and noted flags | What can fire |');

  // Doc round 8: moving detection 4's independence above the table moved its terminal
  // outcome OUT of the table pin, and the cross-surface loop below deliberately exempts
  // this file from the how-a-degraded-run-ends check. Flipping the paragraph to All Clear
  // therefore left everything green. It is a point-of-use assignment like the other four,
  // so it gets the same remedy: compared whole, not searched for a phrase.
  const ROW4_PARA_EXACT = [
    "**Detection 4 sits outside this table's reasoning, and row 4 still can fire on either row ",
    'below.** That is because detection 4 reads `BRANCH`, not the checker and not the tree, so a ',
    'dirty degraded run on `main` fires it exactly as a clean one does. It names no correction ',
    'Skill, so a run where it is the only detection reaches the end with no invocation, and ',
    '`skills/remind/SKILL.md` § Step 4 names the outcome that terminates it. The rows below are ',
    'about **gate** rows only.',
  ].join('');
  const row4At = detection.indexOf('**Detection 4 sits outside');
  assert.notEqual(row4At, -1, 'the reference no longer opens its detection-4 paragraph with the pinned lead-in');
  assert.equal(
    detection.slice(row4At).split('\n\n')[0].replace(/\s+/g, ' ').trim(), ROW4_PARA_EXACT,
    'the detection-4 paragraph changed — re-derive ROW4_PARA_EXACT and check row 4 is still '
      + 'independent of the checker and the tree, and still defers the outcome to § Step 4',
  );
  assert.deepEqual(
    degradedRows, DEGRADED_TABLE_EXACT,
    'the reference degraded table changed — re-derive DEGRADED_TABLE_EXACT and check it still agrees with § Step 4',
  );
});

test('the terminal outcome tokens exist only where the contract defines them', () => {
  // Rounds 30-33 and doc rounds 6-9 were one escape repeated: a pin closed a unit and
  // the contradiction was written BESIDE it — a row the filter missed, a second table,
  // a sentence after the fence, a paragraph after the pinned paragraph. Widening the
  // pin has no fixed point, so the tokens are confined instead: a surface that cannot
  // spell the outcome cannot contradict § Step 4 about it, wherever the sentence sits.
  //
  // What this is NOT (round 34, and worth stating so the next reader does not rely on
  // it for more than it gives): a proof that these documents are consistent. It is a
  // lexical guard over the regressions actually observed. A contradiction phrased
  // without any confined token — "mark the run successful and fully verified" — passes
  // it. Nor is the behavioural block above a substitute: it extracts Step 1's shell and
  // asserts the variables that derivation computes, which is the state contract, not the
  // lifecycle. No test executes § Step 4 or observes a terminal outcome — that half is
  // instructional text, held by whole-section comparison, by these checks, and by
  // document review. These checks only stop the wordings that have gone wrong once.
  const TOKEN = /all clear|degraded ⚠️/gi;
  const skill = readFileSync(skillPath, 'utf8');
  const detection = readFileSync(resolve(root, 'skills/remind/references/detection-rules.md'), 'utf8');
  const spec = readFileSync(resolve(root, 'docs/features/remind/2-tech-spec.md'), 'utf8');

  // Two spans, and each licenses the token only because it is independently compared
  // whole: § Step 4 by STEP4_EXACT, § 3.4 by SECTION_34_EXACT.
  // Only the opening delimiter is asserted unique; that is what fixes which span the
  // slice starts at, and the closing one is the heading the exact comparison ends at.
  const spanOf = (body, label, from, to) => {
    assert.equal(body.split(from).length - 1, 1, `"${from}" must occur exactly once in ${label}`);
    const a = body.indexOf(from);
    const b = body.indexOf(to, a);
    assert.ok(b > a, `the ${label} span ${from} … ${to} is malformed`);
    return [a, b];
  };

  const allowed = {
    'SKILL.md': [skill, [spanOf(skill, 'SKILL.md', '### Step 4: Execute the correction', '## Specific Rule Mode')]],
    'detection-rules.md': [detection, []],
    '2-tech-spec.md': [spec, [spanOf(spec, 'the spec', '### 3.4', '### 3.5')]],
  };

  for (const [label, [body, spans]] of Object.entries(allowed)) {
    for (const m of body.matchAll(TOKEN)) {
      assert.ok(
        spans.some(([a, b]) => m.index > a && m.index < b),
        `${label} spells "${m[0]}" at offset ${m.index}, outside every span this test compares whole; `
          + 'defer to skills/remind/SKILL.md § Step 4 instead of restating the outcome there',
      );
    }
  }

  // The stored-verdict refusal is the one that matters most, because a document
  // telling a model a stored slot may close a gate defeats the whole point of the
  // digest binding. These are spelling guards, not a decision procedure over the
  // claim: they miss forms the patterns do not name and would fire on a negated
  // one, which is why enumerating further synonyms is not the fix — that is the
  // arms race the confinement design above exists to leave.
  for (const [label, body] of [['the spec', spec], ['the reference', detection], ['SKILL.md', skill]]) {
    for (const claim of [
      /stored (PASS|verdict)[^.\n]{0,80}(remain|are|is|stays?) (eligible|read|used)/i,
      /(slot|stored)[^.\n]{0,60}(authoritative|sufficient|enough)[^.\n]{0,60}(closure|closing|gate|review|precommit)/i,
      /treat[^.\n]{0,40}(slot|stored)[^.\n]{0,60}as (authoritative|current|valid|binding)/i,
    ]) {
      assert.ok(
        !claim.test(body),
        `${label} lets a stored verdict close a gate (matched ${claim}); `
          + 'a slot records that a gate was noted, never which tree earned it',
      );
    }
  }
});

test('remind SKILL.md cannot be satisfied by printing a correction without running it', () => {
  // Round-15 finding: the CRITICAL section said "executor" while Step 3 ended at a
  // copy-pasteable list and every checklist item passed without an invocation. The
  // operational half has to carry the contract too, or the contract is decorative.
  const skill = readFileSync(skillPath, 'utf8');
  const checklist = skill.slice(skill.indexOf('## Verification Checklist'));

  assert.match(skill, /### Step 4: Execute the correction/, 'the output step must be followed by an execution step');
  assert.match(checklist, /Every owed correction Skill invoked in this reply/, 'the checklist must require every invocation, not one');
  // Round 22: the checklist used to re-enumerate the three exceptions, and inverting
  // its copy alone left every assertion green. The enumeration was deleted rather
  // than pinned — one contract, in § Step 4 — so what is required here is the
  // pointer, and what is refused is a second copy growing back.
  assert.match(checklist, /defined in § Step 4 and are not restated here/, 'the checklist must defer to Step 4 for the exception list');
  assert.ok(
    !/### All Clear ✅/.test(checklist),
    'the checklist has grown its own copy of the terminal outcomes again',
  );
  assert.match(skill, /Every owed correction, not the first one/, 'Step 4 must say what to do when two rows fire');
  assert.match(skill, /re-read Step 1/i, 'and that the plan is recomputed after each correction');
  assert.match(skill, /Detection 4 is advisory/, 'the finding with no correction Skill must be named as the exception it is');

  // The heading and the "every owed correction" phrase both survive an inverted
  // verb — "Skip them one at a time" keeps each of them. Pin the affirmative
  // instruction itself, and refuse a section that tells the executor to defer.
  const step4 = skill.slice(skill.indexOf('### Step 4: Execute the correction'), skill.indexOf('## Specific Rule Mode'));
  // An enumerated list of negations is an arms race — "Do not run them", "Fail to
  // run them", "Anything but run them" all pass a vocabulary filter. The instruction
  // is pinned as an exact sentence instead, case-sensitively and anchored to a
  // sentence boundary, so no prefix can invert it and still match.
  const IMPERATIVE = 'Run them one at a time and **re-read Step 1 after each**';
  const flat = step4.replace(/\s+/g, ' ');
  const at = flat.indexOf(IMPERATIVE);
  assert.notEqual(at, -1, `Step 4 no longer carries its execution instruction verbatim: "${IMPERATIVE}"`);
  assert.match(
    flat.slice(Math.max(0, at - 2), at + 1),
    /(^|[.!?)*] |\| )R/,
    'the execution instruction has acquired a prefix — it must open its own sentence',
  );
  assert.ok(
    !/\b(skip|defer|postpone|omit|queue) them\b/i.test(step4),
    'Step 4 tells the executor to hold corrections back',
  );

  // The degraded terminal outcome, added in round 19: without it, "re-read Step 1
  // after each" recomputes the same rows forever on a run that has no verdict source.
  assert.match(step4, /at most once/i, 'Step 4 must bound a degraded run to one invocation per correction');
  assert.match(step4, /### Degraded ⚠️/, 'and name the outcome that terminates it');
  assert.match(step4, /[Nn]ot `?### All Clear/, 'explicitly refusing All Clear for a run that verified nothing');

  // Pinning one good sentence proves nothing about the sentences around it: round 20
  // appended "Afterward, fail to run them and only print the table" to this section
  // and every assertion above stayed green — the affirmative imperative was still
  // there, just contradicted. Any rule that enumerates negations loses to the next
  // phrasing, so the whole section is pinned as one exact normalized block instead.
  // Editing Step 4 means editing this constant; that cost is the point, because this
  // is the section three review rounds have found a defect in.
const STEP4_EXACT = [
  '### Step 4: Execute the correction — in the same reply The output above is the traceability ',
  'record, not the deliverable. Immediately after printing it, invoke the correction through ',
  'the Skill tool (`Skill: /codex-review-fast`) and report what it returned. A findings table ',
  'followed by a stop is the exact failure this skill exists to correct — see § Execution ',
  'Contract, which this step is the operational half of. **Every owed correction, not the first ',
  'one.** Two rows can fire at once — a degraded dirty tree owes both `/codex-review-fast` and ',
  '`/codex-review-doc` — and stopping after one leaves the other plane open, which is the same ',
  'defect in a smaller shape. Run them one at a time and **re-read Step 1 after each**: a ',
  'review that edits files moves the tree, so the remaining plan computed before it may no ',
  'longer be the right one. **Detection 4 is advisory and has no correction Skill.** Being on ',
  '`main` is corrected by creating a branch, and `@rules/git-workflow.md` does not authorize ',
  'this skill to run `git checkout`/`switch` — nor is there a branch name to choose. State the ',
  'finding and the command the human can run; that is the whole of it. If detection 4 is the ',
  '*only* finding, this step ends without an invocation. **A degraded run terminates too, and ',
  'not by claiming All Clear.** Without the checker there is no verdict, so re-reading Step 1 ',
  'after a correction returns the *same* rows it returned before — `/codex-review-fast` cannot ',
  'make `CODE_REVIEW` true when nothing can read a verdict. **Degradation dominates the ',
  'terminal status**: whenever `ADV_OK` is false the reply ends at `### Degraded ⚠️`, whether ',
  'or not detection 4 also fired and whether or not a correction ran. Two rules keep that from ',
  'becoming a loop or a false clearance: | Degraded run | What terminates it | ',
  '|--------------|--------------------| | An executable correction fired | Invoke **each ',
  'distinct correction at most once**. When the re-read returns rows already corrected in this ',
  'reply and the checker is still unavailable, stop and report `### Degraded ⚠️` — the ',
  'corrections ran, closure is unverifiable until the checker answers | | No executable ',
  'correction fired | Report `### Degraded ⚠️` as well, naming the checker as the missing ',
  'input. **Not `### All Clear ✅`**, and **not the lone-detection-4 exception either**: ',
  'detection 4 fires on a degraded clean run on `main` and names no Skill, so that run reaches ',
  'the end with no invocation and must still not claim a clearance nothing verified | So the ',
  'complete list of outcomes that end this step without an invocation is **three**: `### All ',
  'Clear ✅` (the checker answered and nothing is owed), a lone detection 4 on a run the ',
  'checker answered, and `### Degraded ⚠️` where no executable correction fired. A degraded ',
  'run that *did* invoke corrections ends at `### Degraded ⚠️` too — that one is a ',
  'termination, not an exception.',
].join('');
  assert.equal(
    flat.trim(), STEP4_EXACT,
    'Step 4 changed — re-derive STEP4_EXACT and re-read the section for a contradicting sentence',
  );

  // The CRITICAL section used to state the same three exceptions for a reader who
  // never reaches Step 4, and round 20 could drop its "on a run the resolver answered"
  // qualifier — or the dominance sentence — with every other assertion green. That is
  // why the enumeration was removed from it entirely: what is pinned below is the
  // deferral that replaced the copy, and the one clause § Step 4 does not carry.
  const CRITICAL_EXACT = [
    '**There are exactly three exceptions, and § Step 4 defines them.** They are not ',
    'enumerated here: this file already learned that a second copy of the lifecycle diverges ',
    'from the first within a round, so the copies were removed rather than kept in sync. What ',
    'belongs here is the part § Step 4 does not carry — every executable owed correction is ',
    'invoked, and "owed" is plural: two findings means two invocations.',
  ].join('');
  // Two more surfaces state the same contract further down the file, and round 21
  // showed each can be inverted alone: the Execution Contract's item 1 ("corrections
  // may repeat indefinitely") and the Graceful Degradation rows ("only the code
  // plane"). Both kept every file-wide regex green while contradicting the blocks
  // above, so both are pinned as normalized closed clauses too.
  // Step 2's degraded table is the last surface that still states a terminal outcome
  // in its own words, and round 22 inverted it alone — "Only row 1 fires" — with all
  // tests green. It is small and normative, so it is pinned; the checklist, being pure
  // restatement, was deleted instead. The correct-flow block was pinned here for the
  // same reason until doc round 5, which removed its terminal lines: it now defers to
  // § Step 4, so CORRECT_FLOW_EXACT pins a deferral rather than a copy.
  const STEP2_DEGRADED_EXACT = [
    [
      '| Tree provably clean | All three `false` — no source for them | No **gate** row: rows 1 ',
      'and 2 need a change flag, row 3 needs `CODE_REVIEW=true`, row 5 needs a noted flag this ',
      'path does not have. Row 4 is unaffected — it reads `BRANCH`, not the checker, so a ',
      'degraded clean run on `main` still reports it, and the run still terminates under § Step 4 |',
    ].join(''),
    [
      '| Tree dirty or unverifiable | All three `false` — no source for them | Rows 1 and 2 both ',
      'fire. Rows 3 and 5 cannot: 3 triggers on `CODE_REVIEW=true`, 5 on a noted flag, and the ',
      'degraded path has neither |',
    ].join(''),
  ];
  const step2Rows = tableRows(skill, '| Degraded run | Verdicts | What fires |');
  assert.deepEqual(
    step2Rows, STEP2_DEGRADED_EXACT,
    "Step 2's degraded table changed — re-derive STEP2_DEGRADED_EXACT and check both planes still open",
  );

  const CORRECT_FLOW_EXACT = [
    '/remind → detect doc-no-review → output findings table → invoke Skill(/codex-review-doc) → report result',
    '/remind → detect code-no-review → output findings table → invoke Skill(/codex-review-fast) → report result',
    "/remind → nothing to invoke → the outcome that terminates the run is § Step 4's to name",
  ];
  assert.deepEqual(
    skill.slice(skill.indexOf('**Correct flow**:')).split('```')[1].trim().split('\n').map((l) => l.trim()),
    CORRECT_FLOW_EXACT,
    'the correct-flow block changed — re-derive CORRECT_FLOW_EXACT and check no run claims a clearance it did not earn',
  );

  const EC_ITEM1_EXACT = [
    '1. **Invoke the correction Skill for every executable owed finding, immediately** in the ',
    'same reply — do not ask for permission, do not output a summary and stop. Two findings ',
    'means two invocations, Step 1 re-read between them. Which runs end without an ',
    "invocation, and how a degraded run terminates, are § Step 4's to state — there are three ",
    'exceptions and this list is not a fourth copy of them',
  ].join('');
  const ecItem1 = skill.slice(skill.indexOf('1. **Invoke the correction Skill')).split('\n2. **Re-read')[0];
  assert.equal(
    ecItem1.replace(/\s+/g, ' ').trim(), EC_ITEM1_EXACT,
    'Execution Contract item 1 changed — re-derive EC_ITEM1_EXACT and check it still agrees with Step 4',
  );

  const GD_ROWS_EXACT = [
    [
      "| jq unavailable | The checker's answer cannot be parsed, so the run degrades to the rows ",
      'below — fail-closed, never silently clean |',
    ].join(''),
    [
      '| Checker unavailable, tree provably clean | Change flags read `false`, verdicts and noted ',
      'flags read `false` (the state slot is never read directly — a clean tree does not bind a ',
      'stored verdict to itself), so no gate row fires; detection 4 still can, reading `BRANCH`. ',
      'The run terminates under § Step 4, which refuses a clearance for a run that verified nothing |',
    ].join(''),
    [
      '| Checker answered with a malformed or partial object (a plane missing, a field ',
      'non-boolean) | Rejected exactly like no answer at all — all seven fields or none. The rows ',
      'below apply |',
    ].join(''),
    [
      '| Checker unavailable, tree dirty or unverifiable | **Both** planes open; verdicts and ',
      'noted flags all read `false`. Rows 1 and 2 fire; **rows 3 and 5 cannot** — 3 triggers on ',
      '`CODE_REVIEW=true` and 5 on a noted flag, and the degraded path has neither. Disclose the ',
      'shared cause once |',
    ].join(''),
    [
      '| State slot missing | Not a degradation: the checker answers `noted:false` for that ',
      "plane, which is exactly detection 5's input — a dirty plane that was never noted |",
    ].join(''),
    '| Rule file not found | List available rules via `Glob("rules/*.md")` |',
  ];
  const gdRows = tableRows(skill, '| Failure | Behavior |');
  assert.deepEqual(
    gdRows, GD_ROWS_EXACT,
    'the Graceful Degradation checker rows changed — re-derive GD_ROWS_EXACT and check both planes still open',
  );

  // Doc review round 5: the checker comment claimed the ladder bounds the call the
  // way the advisory hooks bound theirs. The last rung runs node with no bounding tool
  // at all, so on a host without timeout/gtimeout/perl nothing is bounded — and the
  // git probe never was. The comment is what a reader trusts before reading the shell.
  // Round 30 killed the first version of this pin: requiring the three phrases left
  // `runs node unbounded (which is false)` green, because a substring pin cannot refuse
  // a sentence that carries its own negation. So the whole comment block is closed and
  // compared, the way the spec rows are — nothing can be appended to it unnoticed.
  const BOUND_COMMENT_EXACT = [
    '# Bounded *when a bounding tool exists*: the digest hashes dirty and untracked ',
    '# content, which is unbounded on a pathological tree, and /remind runs ',
    '# interactively. A kill lands in the fallback below. With none of ',
    '# timeout/gtimeout/perl present the last branch runs node unbounded — the ',
    '# ladder has no pure-shell rung. The `git status` probe above is unbounded for ',
    '# the same reason.',
  ].join('');
  const boundAt = skill.indexOf('# Bounded');
  assert.notEqual(boundAt, -1, 'the checker comment no longer opens with the pinned lead-in');
  const boundComment = [];
  for (const line of skill.slice(boundAt).split('\n')) {
    if (!line.trim().startsWith('#')) break;
    boundComment.push(line.trim());
  }
  assert.equal(
    boundComment.join(' '), BOUND_COMMENT_EXACT,
    'the checker boundedness comment changed — re-derive BOUND_COMMENT_EXACT and re-read the ladder below it',
  );

  const critAt = skill.indexOf('**There are exactly three exceptions');
  assert.notEqual(critAt, -1, 'the CRITICAL section no longer opens its exception clause with the pinned lead-in');
  assert.equal(
    skill.slice(critAt).split('\n\n')[0].replace(/\s+/g, ' ').trim(), CRITICAL_EXACT,
    'the CRITICAL exception list changed — re-derive CRITICAL_EXACT and check it still matches Step 4',
  );

  // The CRITICAL section and the Execution Contract used to re-enumerate the three
  // exceptions, and rounds 17 and 20 each found one of them contradicting Step 4.
  // The round-4 doc review named the pattern: keeping three copies in sync is the
  // duplication class the § 3.1 rewrite claimed to have removed. So the enumerations
  // are gone, and what is asserted here is now the opposite of what it was — each
  // section says how many exceptions there are, defers, and carries no copy to drift.
  // The correct-flow block is the third slice, and it was the copy the first version
  // of this loop missed: it mapped checker-answered to All Clear and
  // checker-unavailable to Degraded on its own, so a Step 4 change needed syncing
  // there too. Its terminal lines are gone; the loop now covers it.
  for (const [label, section, prose] of [
    ['the CRITICAL section', skill.slice(0, skill.indexOf('## Trigger')), true],
    ['the Execution Contract', skill.slice(skill.indexOf('## Execution Contract'), skill.indexOf('**Correct flow**')), true],
    ['the correct-flow block', skill.slice(skill.indexOf('**Correct flow**')).split('```')[1], false],
  ]) {
    if (prose) {
      assert.match(section, /\bthree\b/i, `${label} must say how many exceptions there are, and it is three`);
      assert.match(section, /every executable owed/i, `${label} must require every owed invocation, not a singular one`);
    }
    assert.match(section, /§ Step 4/, `${label} must point at the section that defines them`);
    assert.ok(
      !/### All Clear ✅|### Degraded ⚠️/.test(section),
      `${label} has grown its own copy of the terminal outcomes again`,
    );
    assert.ok(
      !/\bonly\b[^.\n]{0,60}All Clear/i.test(section),
      `${label} still calls All Clear the only exception, contradicting Step 4`,
    );
  }
});

test('remind instruction surfaces describe the degraded path the block actually takes', () => {
  // Round-17 finding, carried into the checker contract: the shell reads no verdict
  // and no noted flag on a degraded run, and every prose surface must say so — a
  // model reading a surface that still promises a verdict source discloses
  // `source=state` for a value that was never used. The split is one sentence in
  // each surface, so pin the split, not the sentence.
  const surfaces = [
    ['SKILL.md', readFileSync(skillPath, 'utf8')],
    ['detection-rules.md', readFileSync(resolve(root, 'skills/remind/references/detection-rules.md'), 'utf8')],
    ['2-tech-spec.md', readFileSync(resolve(root, 'docs/features/remind/2-tech-spec.md'), 'utf8')],
  ];

  for (const [label, body] of surfaces) {
    assert.match(
      body,
      /state slot is (never|not)\s+read/i,
      `${label} must state that the state slot is never read directly`,
    );
    assert.match(
      body,
      /binds? the \*?current\*? tree|does not bind a stored verdict|equally clean|commit A/i,
      `${label} must say why a clean tree is not the binding either`,
    );
    assert.match(
      body,
      /(rows?|detections?) 3 and 5 cannot/i,
      `${label} must state the cost: detections 3 and 5 cannot fire on a degraded run`,
    );
    // Detection 4 reads `BRANCH`, never the checker, so "nothing fires on a clean
    // degraded run" is false on `main` — and it is the sentence that lets a reader
    // treat such a run as the lone-detection-4 exception instead of Degraded.
    assert.match(
      body,
      /[Rr]ow 4 (is unaffected|still can)|detection 4 (reads|fires|can)/,
      `${label} must say detection 4 is unaffected by the checker being unavailable`,
    );
    assert.ok(
      !/Nothing — no change flag/.test(body),
      `${label} still claims a degraded clean run fires nothing at all`,
    );

    // A surface can carry the right sentence and a contradicting one at the same
    // time, and the model obeys whichever it reads last — so the correct claims
    // above are paired with a refusal of every wrong one.
    if (label === 'detection-rules.md') {
      assert.match(
        body,
        /malformed or partial answer[\s\S]{0,80}refused like no answer at all/,
        'the reference must say Step 1 refuses a malformed or partial checker answer whole',
      );
    }

    if (label !== 'detection-rules.md') {
      assert.match(body, /all seven/i, `${label} must state the all-or-none acceptance clause`);
      assert.match(body, /at most once/i, `${label} must state that a degraded run invokes each correction once`);
      assert.match(body, /### Degraded ⚠️|`?Degraded ⚠️`?/, `${label} must name the outcome that terminates a degraded run`);
    }

    // Token presence is not the claim. Round 20 rewrote an acceptance clause and
    // inverted the degraded paragraph — both kept every token above, and both
    // passed. SKILL.md's Step 4 is pinned verbatim in its own test; the spec's two
    // operative passages are pinned verbatim here for the same reason.
    if (label === '2-tech-spec.md') {
      const SPEC_PARA = [
        '**Degraded runs terminate explicitly.** Without a verdict source, re-reading Step 1 ',
        'after a correction returns the same rows, so `/remind` invokes each distinct correction ',
        '**at most once** and the run then terminates whether or not a correction fired — a clean ',
        'tree with no readable verdict verified nothing, so no clearance is available to it. ',
        '**Degradation dominates the terminal status**, which is what keeps the lone-detection-4 ',
        'exception from swallowing it: detection 4 reads `BRANCH`, not the checker, so a degraded ',
        'clean run on `main` does fire a row and still has no Skill to invoke, and it terminates ',
        'the same way. Which outcomes end a run without an invocation is enumerated in ',
        '`skills/remind/SKILL.md` § Step 4 and deliberately not repeated here — the same reason ',
        "§ 3.1's graph stops at the delegation node.",
      ].join('');
      // Two claims the spec made about the executable contract and got wrong (doc
      // review round 4): what bounds the detection path, and how a missing rule is
      // discovered. Both are checkable against SKILL.md, so both are pinned here.
      assert.ok(
        !/hard-bounded by/.test(body),
        'the spec claims the detection path is hard-bounded — the git probe carries no timeout at all',
      );
      assert.match(
        body,
        /\*\*Bounded, not hard-bounded\*\*: `AUTO_LOOP_DERIVE_TIMEOUT`[\s\S]{0,200}`git status` probe carries no timeout at all/,
        'the spec must say what is bounded and what is not',
      );
      assert.ok(
        !/`ls rules\/\*\.md`/.test(body),
        'the spec names ls for rule discovery; the executable contract uses Glob',
      );
      // Rounds 5, 30, 31 and 32 each read this table and each found a different way to
      // publish a second contract beside a correct row: a bounded-flat claim, a sentence
      // carrying its own negation, `.find()` taking the first of two same-keyed rows, and
      // finally a differently-keyed row that no keyed filter selects at all. Keyed pins
      // cannot close a table. The whole table is compared, in order.
      const IMPL_TABLE_EXACT = [
        [
          '| `_remind_git()` fence | Unsets the whole `GIT_*` namespace in a subshell — enumerated ',
          'through `env`, never `${!GIT_*}` — then `git -C "$PWD"` | A named subset leaves ',
          '`GIT_CEILING_DIRECTORIES`, `GIT_DIR`, `GIT_CONFIG*` able to redirect or blind the read — ',
          'and a blinded read looks exactly like a clean repository |',
        ].join(''),
        [
          '| `ROOT` | `rev-parse --show-toplevel`, else `$PWD` | `/remind` runs from wherever the ',
          'session is; a cwd-relative checker path degrades an answerable run in `packages/app/` |',
        ].join(''),
        [
          '| Checker call | `review-state.js check --format=json`, installed copy first ',
          '(`.claude/scripts/`), run with `cd "$ROOT"`, bounded by a timeout ladder **when one of ',
          '`timeout`/`gtimeout`/`perl` exists** — the last rung runs node unbounded | The slot is ',
          'keyed by a non-contractual repo hash, so only the checker can locate it and bind it to ',
          'the tree. All seven fields or none — a partial answer must not mix two policies |',
        ].join(''),
        [
          '| Answer validation | Each field is read with a jq **type check** — only a JSON boolean ',
          'passes; a missing plane, a string `"true"`, `null` or any other shape empties the read, ',
          'and one empty field rejects the whole answer like no answer at all | The checker\'s ',
          '`passed` already carries the digest binding, so there is no separate provenance field to ',
          'verify — validation is that the answer has the checker\'s exact shape. A half-parsed ',
          'answer would silently mix checker policy with fallback policy |',
        ].join(''),
        [
          '| The tree probe | **One** whole-tree `status --porcelain=v1 -uall ',
          '--ignore-submodules=none`, run unconditionally. Anything but a clean, quiet, zero-exit ',
          'answer sets `DIRTY` — to the captured output whenever that capture is non-empty (the probe ',
          'runs under `2>&1`, so stdout and stderr arrive merged and `DIRTY` can carry either or both), ',
          'and to the literal `unverifiable` only when the capture is empty, the ',
          'nonzero-exit-with-no-output case. It opens **both** planes only on the branch that cannot ',
          'classify — a rejected or unavailable checker answer; a checker answer keeps its own ',
          'per-plane verdict, dirty tree included | It does not classify: an ordinary pathspec is ',
          'cwd-relative, and a per-plane guess that is wrong hides a gate. It is asked once because two ',
          'probes can disagree — a concurrent editor, a racy wrapper — and classifying from one while ',
          'reporting `DIRTY` from the other minted a false clearance over a moved tree (round 17) |',
        ].join(''),
        [
          '| The verdicts, degraded | Not read from anywhere: `CODE_REVIEW`/`DOC_REVIEW`/`PRECOMMIT` ',
          'are `false` whenever the checker did not answer, and `CODE_NOTED`/`DOC_NOTED` with them | ',
          'The state slot is never read directly, on any run — it lives outside the repo under a ',
          'non-contractual key, and a clean tree does not bind a stored verdict to itself: trusting ',
          'one there let a commit-A PASS close a gate on commit B (round 18) |',
        ].join(''),
        [
          '| `BRANCH` | Same fence, `\\|\\| BRANCH=""` | A different question, so a separate read; a ',
          'redirected environment must not report a feature branch as `main`, and the guard keeps a ',
          '`set -e` caller alive to reach the cleanup line |',
        ].join(''),
      ];
      assert.deepEqual(
        tableRows(body, '| Part | What it does | Why |'), IMPL_TABLE_EXACT,
        'the § 3.3 implementation table changed — re-derive IMPL_TABLE_EXACT and read each row against SKILL.md Step 1',
      );
      assert.match(
        body,
        /via `Glob\("rules\/\*\.md"\)`, the mechanism the executable contract uses/,
        'the spec must name the discovery mechanism SKILL.md actually uses',
      );
      // Refusing one stale spelling leaves every other wrong mechanism — and deleting
      // the row entirely — green. The Risks row is read on its own, so assert the row.
      const renamedRow = body.split('\n').find((l) => l.startsWith('| Rule file renamed |'));
      assert.ok(renamedRow, 'the spec no longer carries the renamed-rule risk row');
      assert.match(
        renamedRow,
        /`Glob\("rules\/\*\.md"\)`/,
        'the renamed-rule mitigation must name the discovery mechanism the skill uses',
      );
      const paraAt = body.indexOf('**Degraded runs terminate explicitly.**');
      assert.notEqual(paraAt, -1, 'the spec no longer opens its degraded paragraph with the pinned lead-in');
      assert.equal(
        body.slice(paraAt).split('\n\n')[0].replace(/\s+/g, ' ').trim(), SPEC_PARA,
        'the spec degraded paragraph changed — re-derive SPEC_PARA and check it was not inverted',
      );
      // § 3.4 is the surface a reader copies the output shape from, and it stated
      // All Clear as "shown when no findings" — which is exactly a degraded clean
      // run. Correct prose earlier in the spec does not repair a template that
      // reintroduces the false clearance (round 20). Doc round 7 then showed that
      // requiring the two correct forms is not the same as pinning the block: a line
      // reading "On a checker failure, print `### All Clear ✅`" injected beside them
      // left all three assertions green. The fenced block is compared whole.
      // Round 32: closing the fence is not closing the section. A sentence placed after
      // the fence and before § 3.5 left the fence byte-identical. The section is
      // compared whole, so the fence and every line around it are one closed unit.
      const SECTION_34_EXACT = [
        '### 3.4 Output Format',
        '',
        '```markdown',
        '## Reminder',
        '',
        '### Findings',
        '',
        '| # | Priority | Rule | Issue | Correction |',
        '|---|----------|------|-------|------------|',
        '| 1 | P0 | auto-loop | Code changed but review not passed | Run `/codex-review-fast` |',
        '| 2 | P1 | git-workflow | Working on main branch | Create feature branch |',
        '',
        '### Corrections (copy-pasteable)',
        '1. `/codex-review-fast`',
        '2. `git checkout -b feat/my-feature`',
        '',
        '### All Clear ✅',
        '(the checker answered **and** there are no findings — never on a degraded run)',
        '',
        '### Degraded ⚠️',
        '(the checker did not answer: nothing was verified, so no clearance is claimed)',
        '```',
      ];
      const sec34 = body
        .slice(body.indexOf('### 3.4'), body.indexOf('### 3.5'))
        .split('\n')
        .map((l) => l.replace(/\s+$/, ''));
      while (sec34.length && sec34[sec34.length - 1] === '') sec34.pop();
      assert.deepEqual(
        sec34, SECTION_34_EXACT,
        'the § 3.4 output section changed — re-derive SECTION_34_EXACT and check All Clear is still refused on a degraded run',
      );
    }

    for (const stale of [
      /verdicts are read from the mirror, unreconciled/i,
      /rows 1 and 2 still fire independently/i,
      /nothing (has )?moved under (them|the mirror)/i,
      /rows? 1, 2 and 3 all fire/i,
      /row 3 fires/i,
      /\bmirror is read\b/i,
      /read (from )?the (mirror|slot) (on|whenever|if)[^.\n]{0,30}clean/i,
      // The retired resolver contract must not resurface in any of the three:
      // its vocabulary is how a reader would be steered back to the deleted path.
      /mirror_planes/,
      /treeState/,
      /gate-derive/,
    ]) {
      assert.ok(!stale.test(body), `${label} still describes the superseded resolver contract (${stale})`);
    }
  }
});

test('remind rule and nuclear modes read the checker, not the state slot directly', () => {
  // A stored verdict is not bound to the tree that earned it: `/remind auto-loop`
  // reading a raw slot reports compliance over an edit made after the note. Both
  // modes must go through Step 1, and say why — a bare mention of "Step 1"
  // survives a rewrite that mentions it and then reads the slot anyway.
  const skill = readFileSync(skillPath, 'utf8');
  const modes = skill.slice(skill.indexOf('## Specific Rule Mode'), skill.indexOf('## Arguments'));
  const specific = modes.slice(0, modes.indexOf('## Nuclear Mode'));
  const nuclear = modes.slice(modes.indexOf('## Nuclear Mode'));

  assert.ok(!/state file \+ git/i.test(modes), 'a mode still names the state file as its detection source');
  assert.match(specific, /Step 1/, 'specific-rule mode must route its check through Step 1');
  assert.match(specific, /Not the state slot directly/, 'and say so, rather than leaving Step 1 a decorative mention');
  assert.match(nuclear, /Step 1/, 'nuclear mode must route its cross-reference through Step 1');
  assert.match(nuclear, /not a second source of truth|never the state slot/i, 'with the same reason stated');
});

test('remind detection rules name the checker-derived variables, not the retired resolver fields', () => {
  const detection = readFileSync(resolve(root, 'skills/remind/references/detection-rules.md'), 'utf8');
  const conditions = detection
    .split('\n')
    .filter((l) => /^\| \d+ \| `[a-z-]+` \|/.test(l))
    .map((l) => l.split('|')[4].trim());

  assert.deepEqual(conditions.slice(0, 3), [
    '`HAS_CODE=true` + `CODE_REVIEW=false`',
    '`HAS_DOC=true` + `DOC_REVIEW=false`',
    '`CODE_REVIEW=true` + `PRECOMMIT=false`',
  ]);
  // And the reference must say where those variables come from — the checker's
  // JSON rendering, not the deleted resolver.
  assert.match(detection, /review-state\.js check --format=json/, 'the field-source paragraph must name the checker call');
  assert.match(detection, /noted, dirty, digest_match, verdict, rounds, passed, owed/, 'and the per-plane shape it returns');
});

test('remind pre-authorizes the node invocation its detection step makes', () => {
  const frontmatter = readFileSync(skillPath, 'utf8').split('---')[1];
  assert.match(frontmatter, /Bash\(node:\*\)/, 'Step 1 runs node directly; without this the skill stops for approval');
});
