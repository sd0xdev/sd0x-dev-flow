const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/remind/SKILL.md');

// --- SKILL.md content assertions ---

test('remind SKILL.md has smart detection with state file', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /detection/i, 'should mention detection');
  assert.match(content, /state/i, 'should reference state file');
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

// --- WB5c: the stored change flags are deleted, so /remind must not read them ---
//
// These execute the skill's own Step 1 block rather than pattern-matching it: a
// grep over instruction text stays green when the executable lines are deleted.

const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } = require('node:fs');
const { tmpdir } = require('node:os');

function step1Block() {
  const skill = readFileSync(skillPath, 'utf8');
  const after = skill.slice(skill.indexOf('### Step 1'));
  const open = after.indexOf('```bash') + '```bash\n'.length;
  return after.slice(open, after.indexOf('```', open));
}

// Hermetic: every child gets its own HOME, cache and TMPDIR, and inherits no
// GIT_* variable. Without this the resolver writes receipt directories into the
// developer's real cache, and an ambient core.hooksPath / commit.gpgSign / a
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

function runStep1(build, { subdir = '', env: extraEnv = {}, shellPrelude = '' } = {}) {
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

    const script = `${shellPrelude}${step1Block()}\nprintf '%s %s %s %s %s %s %s %s %s\\n' "$HAS_CODE" "$HAS_DOC" "$CODE_REVIEW" "$DOC_REVIEW" "$PRECOMMIT" "\${BRANCH:-none}" "\${DIRTY:+dirty}" "$STATE_FILE_EXISTS" "$(for f in _remind_git _remind_bool; do type -t "$f" >/dev/null 2>&1 && printf '%s,' "$f"; done || true)"\n`;
    const started = Date.now();
    const out = execFileSync('bash', ['-c', script], {
      cwd: resolve(repo, subdir),
      encoding: 'utf8',
      env: harnessEnv(rootDir, typeof extraEnv === 'function' ? extraEnv(repo) : extraEnv),
    }).trim().split('\n').pop();
    const [hasCode, hasDoc, codeReview, docReview, precommit, branch, dirty, stateFile, fnLeft] = out.split(' ');
    return {
      hasCode, hasDoc, codeReview, docReview, precommit, branch,
      dirty: dirty || '', stateFile, fnLeft: fnLeft || '', elapsedMs: Date.now() - started,
    };
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function installResolver(repo) {
  mkdirSync(resolve(repo, '.claude/scripts/lib'), { recursive: true });
  cpSync(resolve(root, 'scripts/lib'), resolve(repo, '.claude/scripts/lib'), { recursive: true });
}

function fakeResolver(repo, body) {
  mkdirSync(resolve(repo, '.claude/scripts/lib'), { recursive: true });
  writeFileSync(resolve(repo, '.claude/scripts/lib/gate-derive.js'), body);
}

function commitBase(repo, git) {
  writeFileSync(resolve(repo, 'app.js'), 'module.exports = 1;\n');
  writeFileSync(resolve(repo, 'guide.md'), '# Guide\n');
  // As real projects do — otherwise the mirror and the installed libraries are
  // themselves untracked content, and "clean tree, with verdicts recorded and a
  // resolver installed" is a state no fixture could build.
  writeFileSync(resolve(repo, '.gitignore'), '.claude_review_state.json\n.claude/\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
}

// A mirror claiming three passing gates with no receipt log behind it. Since round
// 18 no degraded path reads it at all, so this fixture's job is the opposite of what
// it once was: it is the state in which a verdict is available to be borrowed, and
// every assertion over it checks that nothing borrowed one. On a derivable tree the
// resolver still derives `false` from the absent receipts.
function cleanMirror(repo, git) {
  commitBase(repo, git);
  writeFileSync(resolve(repo, '.claude_review_state.json'), JSON.stringify({
    code_review: { passed: true }, doc_review: { passed: true }, precommit: { passed: true },
  }));
}

function staleMirror(repo, git) {
  commitBase(repo, git);
  writeFileSync(resolve(repo, '.claude_review_state.json'), JSON.stringify({ precommit: { passed: true } }));
  writeFileSync(resolve(repo, 'app.js'), 'module.exports = 2;\n');
}

test('remind Step 1 in a consuming project resolves through the INSTALLED library path', () => {
  // Arrange: only `.claude/scripts/lib/` exists — the layout /install-scripts produces.
  const seen = runStep1((repo, git) => {
    staleMirror(repo, git);
    installResolver(repo);
  });

  // Assert: the derived verdict won over the stale mirror, which only happens if
  // the installed path resolved. Plane classification alone would not prove it —
  // the fallback classifies this same tree identically.
  assert.equal(seen.precommit, 'false', 'a mirror PASS with no receipt behind it must not survive derivation');
  assert.equal(seen.hasCode, 'true', 'a modified .js must open the code plane');
  assert.equal(seen.hasDoc, 'false', 'no doc-plane file changed');
});

test('remind Step 1 with no resolver installed reads no verdict at all, clean tree included', () => {
  // Round 18: a clean `git status` does not bind a stored verdict to the tree in
  // front of it. It says nothing is uncommitted *now* — equally true one checkout
  // later — so trusting the mirror here let a PASS earned on one commit close a gate
  // on another. The degraded run answers the change question and stops there.
  const seen = runStep1(cleanMirror);

  assert.equal(seen.precommit, 'false', 'an unbound PASS is not a verdict, however clean the tree');
  assert.equal(seen.codeReview, 'false', 'the same for the code gate');
  assert.equal(seen.docReview, 'false', 'and the doc gate');
  assert.equal(seen.stateFile, 'true', 'the file was there to be read — the block chose not to');
  assert.equal(seen.hasCode, 'false', 'the change question is still answered, and this tree is clean');
});

test('remind Step 1 refuses a mirror PASS recorded against a different commit', () => {
  // The exact scenario: three PASSes recorded on commit A, then a commit B whose
  // tree is just as clean. Every local signal available to a degraded run is
  // identical in both states, which is why no local signal can be the binding.
  const seen = runStep1((repo, git) => {
    cleanMirror(repo, git);
    writeFileSync(resolve(repo, 'app.js'), 'module.exports = 2;\n');
    git('add', '-A');
    git('commit', '-qm', 'B: unrelated work, committed — tree clean again');
  });

  assert.equal(seen.dirty, '', 'commit B leaves a clean tree, exactly like commit A');
  assert.equal(seen.codeReview, 'false', 'a PASS from commit A cannot close commit B\'s code gate');
  assert.equal(seen.docReview, 'false', 'nor its doc gate');
  assert.equal(seen.precommit, 'false', 'nor its precommit gate');
});

test('remind Step 1 refuses stale mirror verdicts on a tree that moved under them', () => {
  // The All Clear this skill must never produce: resolver gone, every verdict in the
  // mirror a PASS, and a dirty tree. The mirror records that a gate passed, not which
  // tree passed it — that binding is the resolver's whole job, and it is what is
  // missing here. Read as-is, three stale PASSes and a dirty worktree add up to
  // "nothing owed" while a real review is outstanding.
  const seen = runStep1((repo, git) => {
    cleanMirror(repo, git);
    writeFileSync(resolve(repo, 'app.js'), 'module.exports = 2;\n');
    writeFileSync(resolve(repo, 'guide.md'), '# Guide, revised\n');
  });

  assert.equal(seen.hasCode, 'true', 'the dirty tree owes both planes');
  assert.equal(seen.hasDoc, 'true', 'the dirty tree owes both planes');
  assert.equal(seen.codeReview, 'false', 'an unbound PASS cannot close the code gate');
  assert.equal(seen.docReview, 'false', 'an unbound PASS cannot close the doc gate');
  assert.equal(seen.precommit, 'false', 'nor the precommit gate — this is the row that would mint All Clear');
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
    // Arrange: a resolver-less run over a git whose
    // successive status answers contradict each other. The counter lives outside the
    // harness directory, which the run deletes on its way out.
    const probeDir = mkdtempSync(resolve(tmpdir(), 'remind-probe-'));
    const counter = resolve(probeDir, 'status-count');
    try {
      const seen = runStep1((repo, git, rootDir) => {
        cleanMirror(repo, git);
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
        assert.equal(seen.codeReview, 'false', 'and carries no mirror verdict');
        assert.equal(seen.docReview, 'false', 'and carries no mirror verdict');
        assert.equal(seen.precommit, 'false', 'and carries no mirror verdict');
      } else {
        assert.equal(seen.hasCode, 'false', 'a clean answer classifies the tree as clean — the negative control');
        assert.equal(seen.hasDoc, 'false', 'both planes, from the same one answer');
      }
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });
}

test('remind Step 1 abandons a resolver that outruns AUTO_LOOP_DERIVE_TIMEOUT', () => {
  // Arrange: a resolver that would answer correctly, eventually. /remind is
  // interactive, so the bound matters more than the answer. A harness-local
  // `timeout` shim pins which ladder arm runs, instead of leaving that to whatever
  // the host happens to have installed.
  const seen = runStep1(
    (repo, git, rootDir) => {
      staleMirror(repo, git);
      fakeResolver(repo, 'setTimeout(() => process.stdout.write("{}"), 9000);\n');
      const shim = resolve(rootDir, 'bin/timeout');
      writeFileSync(shim, '#!/bin/sh\nsecs="$1"; shift\n"$@" &\np=$!\n(sleep "$secs"; kill -9 $p 2>/dev/null) &\nw=$!\nwait $p; rc=$?\nkill $w 2>/dev/null\nexit $rc\n');
      execFileSync('chmod', ['+x', shim]);
    },
    { env: { AUTO_LOOP_DERIVE_TIMEOUT: '1' } },
  );

  assert.equal(seen.hasCode, 'true', 'the timed-out resolver must land in the git fallback, which sees the dirty tree');
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

const RESOLVER_FIELDS = [
  'has_code_change', 'has_doc_change', 'code_review_passed', 'doc_review_passed', 'precommit_passed',
];

for (const omitted of RESOLVER_FIELDS) {
  test(`remind Step 1 refuses a resolver answer missing ${omitted} rather than mixing policies`, () => {
    // Arrange: valid JSON, correct provenance, four of the five fields. Accepting it
    // would leave one empty and silently mix a derived answer with the fallback's —
    // so each field is dropped in turn, since a condition that forgot one term still
    // rejects the rest.
    // Every present field is `true`, so a half-accepted answer would be visible:
    // the fallback on this dirty tree reports every verdict `false`.
    const answer = {
      treeState: 'ok',
      mirror_planes: [],
      ...Object.fromEntries(RESOLVER_FIELDS.filter((f) => f !== omitted).map((f) => [f, true])),
    };
    const seen = runStep1((repo, git) => {
      staleMirror(repo, git);
      fakeResolver(repo, `process.stdout.write(JSON.stringify(${JSON.stringify(answer)}));\n`);
    });

    assert.equal(seen.codeReview, 'false', 'a partial answer must be discarded whole, not read field by field');
    assert.equal(seen.hasCode, 'true', 'the git fallback, not the half-accepted answer, classified the tree');
  });
}

test('remind Step 1 accepts a complete resolver answer', () => {
  // Positive control for the partial-answer guard: same fake-resolver mechanism,
  // all five fields present, so the guard cannot pass by rejecting everything.
  const seen = runStep1((repo, git) => {
    staleMirror(repo, git);
    fakeResolver(repo, `process.stdout.write(JSON.stringify({
      treeState: 'ok', mirror_planes: [],
      has_code_change: false, has_doc_change: true,
      code_review_passed: true, doc_review_passed: false, precommit_passed: false,
    }));\n`);
  });

  assert.equal(seen.hasDoc, 'true', 'the resolver answer must win over the git fallback');
  assert.equal(seen.codeReview, 'true', 'a derived verdict is the one thing that can close a gate here');
});

// The resolver serves several callers and deliberately keeps the mirror
// authoritative where a digest receipt has no tree to bind to. Those are the same
// stored verdicts Step 1 refuses to read itself, so an answer carrying them is
// refused whatever route it arrived by.
for (const [name, provenance] of [
  ['treeState is not-a-repo', "treeState: 'not-a-repo', mirror_planes: ['code_review', 'doc_review', 'precommit']"],
  ['a single plane fell back to the mirror', "treeState: 'ok', mirror_planes: ['precommit']"],
  ['provenance fields are absent altogether', ''],
  // Each clause of the contract gets a case only it can reject: a `not-a-repo`
  // answer that names no fallback plane, and an `ok` answer with the field missing.
  // Without these, either clause could be deleted and the other would cover for it.
  ['treeState is not-a-repo with no plane named', "treeState: 'not-a-repo', mirror_planes: []"],
  ['mirror_planes is missing from an otherwise ok answer', "treeState: 'ok'"],
  // jq measures length, not shape: `"" | length` and `{} | length` are both 0, so a
  // length test alone reads a malformed answer as derived and lets its verdicts
  // through (round 20). The clause checks the type, and these are the cases only the
  // type check can reject.
  ['mirror_planes is an empty string', "treeState: 'ok', mirror_planes: ''"],
  ['mirror_planes is an empty object', "treeState: 'ok', mirror_planes: {}"],
  ['mirror_planes is a boolean', "treeState: 'ok', mirror_planes: true"],
  ['mirror_planes is null', "treeState: 'ok', mirror_planes: null"],
  // The `treeState` half needs its own killers too: with only the cases above, the
  // clause could be relaxed to `treeState != "not-a-repo"` and every one of them
  // would still behave (round 21). These two are accepted by that mutant and
  // refused by the real clause.
  ['treeState is unverifiable with an empty plane list', "treeState: 'unverifiable', mirror_planes: []"],
  ['treeState is missing from an otherwise derived answer', 'mirror_planes: []'],
]) {
  test(`remind Step 1 refuses a mirror-backed resolver answer — ${name}`, () => {
    const seen = runStep1((repo, git) => {
      staleMirror(repo, git);
      fakeResolver(repo, `process.stdout.write(JSON.stringify({
        ${provenance}${provenance ? ',' : ''}
        has_code_change: false, has_doc_change: false,
        code_review_passed: true, doc_review_passed: true, precommit_passed: true,
      }));\n`);
    });

    assert.equal(seen.codeReview, 'false', 'a mirror-backed PASS closes nothing, whatever carried it');
    assert.equal(seen.precommit, 'false', 'nor the precommit gate');
    assert.equal(seen.hasCode, 'true', 'and the run falls back to git, which sees the dirty tree');
  });
}

test('remind Step 1 refuses the real resolver answer built from a forged mirror outside a repository', () => {
  // Codex's round-19 scenario, run against the INSTALLED resolver rather than a
  // fake: outside a repository `resolveAdvisory()` names its mirror-backed planes
  // and hands back the stored values. With a forged all-PASS state file and no
  // change flags, accepting that answer would report nothing owed — and the state
  // file's existence would suppress detection 5 as well, leaving no finding at all.
  const seen = runStep1((repo, git) => {
    commitBase(repo, git);
    installResolver(repo);
    writeFileSync(resolve(repo, '.claude_review_state.json'), JSON.stringify({
      code_review: { passed: true }, doc_review: { passed: true }, precommit: { passed: true },
    }));
    rmSync(resolve(repo, '.git'), { recursive: true, force: true });
  });

  assert.equal(seen.stateFile, 'true', 'the forged file is there, and its existence still suppresses detection 5');
  assert.equal(seen.codeReview, 'false', 'so the verdicts are what must not be borrowed from it');
  assert.equal(seen.docReview, 'false', 'none of the three');
  assert.equal(seen.precommit, 'false', 'none of the three');
  assert.equal(seen.hasCode, 'true', 'an unverifiable tree owes both planes, which is what leaves a finding');
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
    '_remind_git() ( for v in ${!GIT_*}; do unset "$v"; done; git -C "$PWD" "$@" )',
    'the fence must unset every enumerated name unconditionally, in a subshell, with -C "$PWD"',
  );
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

test('remind Step 1 run from a subdirectory reads the state file at the repository root', () => {
  // Arrange: the mirror lives at the root, as it always does, and the run happens in
  // `sub/`. Resolved relative to the CWD there is no state file at all, so the run
  // would report no verdicts and no state — over a root that holds them.
  const seen = runStep1(
    (repo, git) => {
      cleanMirror(repo, git);
      mkdirSync(resolve(repo, 'sub'));
    },
    { subdir: 'sub' },
  );

  // Resolved relative to `sub/` there is no state file, so this boolean is the whole
  // evidence of anchoring — and it is detection 5's input, not a cosmetic field.
  assert.equal(seen.stateFile, 'true', 'the root state file is the one this run is about');
});

test('remind Step 1 run from a subdirectory resolves the library at the repository root', () => {
  // Same anchoring question for the resolver: installed at the root, run from `sub/`.
  // The derived answer differs from the mirror's, which is what makes it visible —
  // a cwd-relative path finds nothing and falls back to the stale `true`.
  const seen = runStep1(
    (repo, git) => {
      cleanMirror(repo, git);
      installResolver(repo);
      mkdirSync(resolve(repo, 'sub'));
    },
    { subdir: 'sub' },
  );

  // Clean tree, mirror says PASS, no receipt behind it. Anchored, the resolver
  // answers `false`; unanchored, the library is not found and the fallback reads the
  // mirror's `true` — the tree being clean is what keeps that difference visible.
  assert.equal(seen.precommit, 'false', 'the root-installed resolver answered, overriding the mirror');
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

test('remind Step 1 survives a malformed resolver answer under set -e', () => {
  // Nonempty but unparseable: `jq` exits nonzero inside the helper, and an
  // unguarded command substitution would abort the caller's shell before the
  // fallback — the branch whose whole job is to answer when the resolver cannot.
  const seen = runStep1(
    (repo, git) => {
      staleMirror(repo, git);
      fakeResolver(repo, 'process.stdout.write("{not json at all");\n');
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
// not a guard, so the corrupt-state case runs in both.
for (const [mode, prelude] of [['set -e', 'set -e\n'], ['set -e + inherit_errexit', 'set -e\nshopt -s inherit_errexit\n']]) {
  test(`remind Step 1 is inert to a corrupt state file under ${mode}`, () => {
    const seen = runStep1(
      (repo, git) => {
        // Clean tree, so nothing else can be the reason the run survives.
        commitBase(repo, git);
        writeFileSync(resolve(repo, '.claude_review_state.json'), '{"precommit": {"passed": tru');
      },
      { shellPrelude: prelude },
    );

    assert.equal(seen.precommit, 'false', 'an unparseable verdict is no verdict');
    assert.equal(seen.stateFile, 'true', 'the file exists — detection 5 reads that, and nothing else reads further');
    assert.equal(seen.fnLeft, '', 'a file the step never parses cannot abort it: cleanup still ran');
  });
}

test('remind Step 1 outside a repository still reads the state file beside it', () => {
  // ROOT falls back to $PWD when `rev-parse --show-toplevel` refuses. Without that
  // fallback ROOT is empty and every anchored path becomes absolute from the
  // filesystem root — `/.claude_review_state.json` — so a run outside a repository
  // loses the verdicts sitting right next to it and re-reports settled gates.
  const seen = runStep1((repo, git) => {
    commitBase(repo, git);
    rmSync(resolve(repo, '.git'), { recursive: true, force: true });
    writeFileSync(resolve(repo, '.claude_review_state.json'), JSON.stringify({
      code_review: { passed: true }, precommit: { passed: true },
    }));
  });

  assert.equal(seen.stateFile, 'true', 'the state file beside the CWD is the one this run is about');
  assert.equal(seen.hasCode, 'true', 'the tree itself is unprovable, so both planes stay owed');
  assert.equal(seen.codeReview, 'false', 'and an unprovable tree cannot be closed by an unbound verdict');
});

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
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const seen = runStep1((repo, git, rootDir) => {
    commitBase(repo, git);
    const shim = resolve(rootDir, 'bin/git');
    writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "warning: stale index extension, ignoring" >&2\nexec ${realGit} "$@"\n`);
    execFileSync('chmod', ['+x', shim]);
  });

  assert.equal(seen.hasCode, 'true', 'a warning must not be read as an empty, clean answer');
  assert.equal(seen.hasDoc, 'true', 'both planes are owed when the answer cannot be trusted to be empty');
});

test('remind Step 1 without the resolver owes BOTH planes for a doc-only change', () => {
  // The degraded path does not classify — only the resolver does, by full-path
  // suffix over the whole repository. An untracked file also proves `-uall` is
  // load-bearing: with untracked files suppressed this tree reads as clean.
  const seen = runStep1((repo, git) => {
    commitBase(repo, git);
    writeFileSync(resolve(repo, 'tutorial.mdx'), '# Tutorial\n');
  });

  assert.equal(seen.hasDoc, 'true', 'an untracked doc file must open the doc plane');
  assert.equal(seen.hasCode, 'true', 'the degraded path over-reminds rather than guessing a plane');
});

test('remind Step 1 without the resolver is not fooled by a directory whose name ends in .md', () => {
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

test('remind Step 1 without the resolver reports BOTH planes for a cross-plane rename', () => {
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

test('remind Step 1 without the resolver classifies a path containing quotes and spaces', () => {
  const seen = runStep1((repo, git) => {
    commitBase(repo, git);
    writeFileSync(resolve(repo, 'odd "release" notes.md'), '# Notes\n');
  });

  assert.equal(seen.hasDoc, 'true', 'a path git renders with quotes and escapes is still a dirty tree');
  assert.equal(seen.hasCode, 'true', 'the degraded path owes both planes');
});

test('remind Step 1 executable lines never read the state file for anything but its existence', () => {
  // Arrange: strip comments so an explanatory mention of a field cannot satisfy —
  // or trip — this guard.
  const code = step1Block().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  // Assert (negative): the retired change flags are gone, and so is every read of a
  // verdict — round 18 removed the last one, because no local check can bind a
  // stored verdict to the tree in front of it.
  assert.ok(!/\$STATE\b/.test(code), 'the state file contents are read into a variable again');
  assert.ok(!/(code_review|doc_review|precommit)\.passed/.test(code), 'a verdict is still parsed out of the mirror');
  assert.ok(!/\bcat\b[^\n]*STATE_FILE|\$\(<\s*"?\$STATE_FILE/.test(code), 'the state file contents are still being read');
  assert.ok(!/STATE_FILE[^\n]*\bjq\b|\bjq\b[^\n]*STATE_FILE/.test(code), 'the mirror is being parsed again');

  // Assert (positive control): the path is still built and its existence still
  // tested, so the guards above cannot pass by deleting the state file entirely —
  // the resolver is handed that path, and detection 5 reads that boolean.
  assert.match(code, /STATE_FILE="\$ROOT\/\.claude_review_state\.json"/, 'the state-file path is still resolved for the resolver');
  assert.match(code, /STATE_FILE_EXISTS=.*test -f "\$STATE_FILE"/, 'and its existence is still detection 5\'s input');
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
    condition: [/has_code\w*\s*=\s*true/i, /code_review\w*\s*=\s*false/i],
  },
  {
    label: /doc[- ](changed|no)/i, id: 'doc-no-review', conjunction: true,
    condition: [/has_doc\w*\s*=\s*true/i, /doc_review\w*\s*=\s*false/i],
  },
  {
    label: /precommit/i, id: 'review-no-precommit', conjunction: true,
    condition: [/code_review\w*\s*=\s*true/i, /precommit\w*\s*=\s*false/i],
  },
  {
    // The one row whose polarity is an equality rather than a `=true`/`=false`: the
    // pin has to be the positive form itself, since naming the three tokens leaves
    // "`BRANCH` is *not* `main` or `master`" matching every one of them.
    label: /main[- ]branch/i, id: 'main-branch',
    condition: [/branch/i, /(is|=)\s*`?main`?\s*(or|\/)\s*`?master`?/i],
  },
  {
    label: /dirty/i, id: 'dirty-no-state', conjunction: true,
    condition: [/dirty/i, /no state file|state_file_exists\s*=\s*false/i],
  },
];

// The retired detection is recognizable by its condition, not only by its name. Any
// row saying the stored state "says changes" has resurrected it, whatever it is
// called and whichever position it occupies.
const RETIRED_CONDITIONS = [/says? changes/i, /state[- ]drift/i, /mirror.{0,3}tree/i];

// A detection states when it fires. Every live condition is written in the positive,
// and a negation inside one inverts what the model looks for while every field name
// the row mentions stays put — the failure a token-presence pin cannot see.
const NEGATED_CONDITION = /\b(not|never|unless|isn'?t|aren'?t)\b|≠|!==?/i;

// Four of the five rows fire on two facts holding *together*. Naming both facts is
// not enough: "`HAS_CODE=true` or `CODE_REVIEW=false`" mentions the same two and
// fires on a reviewed tree with an unreviewed sibling plane, or on nothing at all.
// Row 4 is the exception — its `main` **or** `master` is a genuine disjunction over
// one fact — so the pin is per-row, not global.
const CONJUNCTION = /\+|\band\b/i;
const DISJUNCTION = /\bor\b|\|\|/i;

// Each surface names the same facts in its own vocabulary — SKILL.md uses the shell
// variables the block sets, the other two use the resolver's field names — so the
// expected set is per surface. It is an EXACT set: a row that adds a fact is as
// wrong as one that drops it, and `HAS_CODE=true + CODE_REVIEW=false + PRECOMMIT=true`
// (which asks for a review only after precommit already passed) satisfies every
// presence, polarity and conjunction pin while inverting when the row fires.
const SKILL_FACTS = [
  ['has_code=true', 'code_review=false'],
  ['has_doc=true', 'doc_review=false'],
  ['code_review=true', 'precommit=false'],
  [],
  ['state_file_exists=false'],
];
const RESOLVER_FACTS = [
  ['has_code_change=true', 'code_review_passed=false'],
  ['has_doc_change=true', 'doc_review_passed=false'],
  ['code_review_passed=true', 'precommit_passed=false'],
  [],
  ['state_file_exists=false'],
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
// owed-review state inverted. So the identifiers a row MENTIONS are compared too,
// canonicalized across the two vocabularies (`HAS_CODE` and `has_code_change` are the
// same fact under different names).
const GATE_IDENTIFIERS = /\b(has_code(_change)?|has_doc(_change)?|code_review(_passed)?|doc_review(_passed)?|precommit(_passed)?|branch|dirty|state_file_exists)\b/gi;

function identsIn(cell) {
  return [...new Set(
    [...cell.matchAll(GATE_IDENTIFIERS)].map((m) => m[0].toLowerCase().replace(/_(change|passed)$/, '')),
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
    facts: SKILL_FACTS,
    idents: [['code_review', 'has_code'], ['doc_review', 'has_doc'], ['code_review', 'precommit'], ['branch'], ['dirty', 'state_file_exists']],
    exact: [
      'HAS_CODE=true + CODE_REVIEW=false',
      'HAS_DOC=true + DOC_REVIEW=false',
      'CODE_REVIEW=true + PRECOMMIT=false',
      'BRANCH is main or master',
      'DIRTY non-empty + STATE_FILE_EXISTS=false',
    ],
    targets: RULE_TARGETS,
  },
  {
    path: 'skills/remind/references/detection-rules.md',
    heading: '## Detection → Rule Mapping',
    labelCol: 1, conditionCol: 3, actionCol: 4,
    facts: RESOLVER_FACTS,
    idents: [['code_review', 'has_code'], ['doc_review', 'has_doc'], ['code_review', 'precommit'], ['branch'], ['dirty', 'state_file_exists']],
    exact: [
      'has_code_change=true + code_review_passed=false',
      'has_doc_change=true + doc_review_passed=false',
      'code_review_passed=true + precommit_passed=false',
      "BRANCH (Step 1's fenced git rev-parse --abbrev-ref HEAD) = main or master — a detached HEAD reads HEAD and matches neither",
      'DIRTY non-empty + STATE_FILE_EXISTS=false',
    ],
    targets: RULE_TARGETS,
  },
  {
    path: 'docs/features/remind/2-tech-spec.md',
    heading: '#### Detection Rules',
    labelCol: 1, conditionCol: 3, actionCol: 4,
    // Row 5 states its second fact in prose ("no state file"), and row 4 has no
    // boolean fact at all — both are covered by the condition regexes above.
    facts: [...RESOLVER_FACTS.slice(0, 4), []],
    idents: [['code_review', 'has_code'], ['doc_review', 'has_doc'], ['code_review', 'precommit'], ['branch'], ['dirty']],
    exact: [
      'has_code_change=true + code_review_passed=false',
      'has_doc_change=true + doc_review_passed=false',
      'code_review_passed=true + precommit_passed=false',
      'BRANCH = main/master',
      'DIRTY non-empty + no state file',
    ],
    // The correction column, not a rule path: each row's dispatch, anchored so a
    // swapped command cannot hide inside surrounding prose.
    targets: [/^`\/codex-review-fast`$/, /^`\/codex-review-doc`$/, /^`\/precommit`$/, /feature branch/, /^Load `CLAUDE\.md` § Required Checks/],
  },
];

for (const surface of DETECTION_SURFACES) {
  const { path, heading, labelCol, conditionCol, actionCol, facts, idents, exact, targets } = surface;

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
        assert.ok(!retired.test(row.join(' ')), `a row of ${path} carries the retired state-drift condition`);
      }
    }

    // Assert: each row is the detection its position claims, and says the same thing
    // the other two surfaces say — the label identifies it, the condition carries its
    // polarity (`=true` / `=false`, not merely the field name), and the action column
    // names the rule or correction it dispatches. Token presence alone let a
    // condition be inverted and a correction be swapped while the test stayed green.
    rows.forEach((row, i) => {
      const { label, condition, conjunction } = LIVE_DETECTIONS[i];
      assert.deepEqual(
        factsIn(row[conditionCol]), [...facts[i]].sort(),
        `row ${i + 1} of ${path} fires on a different set of facts than the other surfaces`,
      );
      assert.deepEqual(
        identsIn(row[conditionCol]), [...idents[i]].sort(),
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
        assert.match(row[conditionCol], CONJUNCTION, `row ${i + 1} of ${path} no longer joins its two facts`);
        assert.ok(
          !DISJUNCTION.test(row[conditionCol]),
          `row ${i + 1} of ${path} fires on either fact alone, not on both together`,
        );
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
  // from Step 4 (no edge for a lone detection 4 on a run the resolver answered). A
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
  // carried its own \u201cends at Degraded\u201d cell with only its detection IDs pinned. Round 31
  // then showed a prefix filter is not a table pin \u2014 a row keyed on anything but `Tree `
  // was simply not selected, so a contradicting row could be added beside the pinned two.
  // The table is sliced at its own boundaries and every data row is compared in order.
  const DEGRADED_TABLE_EXACT = [
    [
      "| Tree provably clean | All `false` | No **gate** row \u2014 no change flag, no verdict, no ",
      "`DIRTY` |",
    ].join(''),
    [
      "| Tree dirty or unverifiable | All `false` | Rows 1 and 2 (plus row 5 with no state file); ",
      "**row 3 cannot**, its trigger being `code_review_passed=true` |",
    ].join(''),
  ];
  const degradedRows = tableRows(detection, '| Degraded run | The three verdicts | What can fire |');

  // Doc round 8: moving detection 4's independence above the table moved its terminal
  // outcome OUT of the table pin, and the cross-surface loop below deliberately exempts
  // this file from the how-a-degraded-run-ends check. Flipping the paragraph to All Clear
  // therefore left everything green. It is a point-of-use assignment like the other four,
  // so it gets the same remedy: compared whole, not searched for a phrase.
  const ROW4_PARA_EXACT = [
    "**Detection 4 sits outside this table's reasoning, and row 4 still can fire on either row ",
    "below.** That is because detection 4 reads `BRANCH`, not the resolver and not the tree, so a ",
    "dirty degraded run on `main` fires it exactly as a clean one does. It names no correction ",
    "Skill, so a run where it is the only detection reaches the end with no invocation, and ",
    "`skills/remind/SKILL.md` \u00a7 Step 4 names the outcome that terminates it. The rows below are ",
    "about **gate** rows only.",
  ].join('');
  const row4At = detection.indexOf('**Detection 4 sits outside');
  assert.notEqual(row4At, -1, 'the reference no longer opens its detection-4 paragraph with the pinned lead-in');
  assert.equal(
    detection.slice(row4At).split('\n\n')[0].replace(/\s+/g, ' ').trim(), ROW4_PARA_EXACT,
    'the detection-4 paragraph changed \u2014 re-derive ROW4_PARA_EXACT and check row 4 is still '
      + 'independent of the resolver and the tree, and still defers the outcome to \u00a7 Step 4',
  );
  assert.deepEqual(
    degradedRows, DEGRADED_TABLE_EXACT,
    'the reference degraded table changed \u2014 re-derive DEGRADED_TABLE_EXACT and check it still agrees with \u00a7 Step 4',
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
  // whole: § Step 4 by STEP4_EXACT, § 3.4 by SECTION_34_EXACT. There was briefly a
  // third — the tree-probe rationale in § 3.3's implementation table, which recorded
  // that a bug once "minted All Clear". It defines no outcome, so the sentence was
  // reworded to "minted a false clearance" and the licence dropped rather than
  // documented (round 34 / doc 10).
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

  // The mirror-authority refusal is the one that matters most, because a document
  // telling a model the mirror may close a gate defeats the whole point of content
  // addressing. Round 34 got past the first version of it with "treat advisory-mirror
  // PASS entries as authoritative", so a second and third spelling were added. They are
  // still spelling guards, not a decision procedure over the claim: they miss forms these
  // three patterns do not name ("use mirror PASS records to close the review gate") and
  // they would fire on a negated one ("the mirror is not authoritative for gate closure"),
  // which is why enumerating further synonyms is not the fix — that is the arms race the
  // confinement design above exists to leave.
  for (const [label, body] of [['the spec', spec], ['the reference', detection], ['SKILL.md', skill]]) {
    for (const claim of [
      /stored (PASS|verdict)[^.\n]{0,80}(remain|are|is|stays?) (eligible|read|used)/i,
      /(mirror|stored)[^.\n]{0,60}(authoritative|sufficient|enough)[^.\n]{0,60}(closure|closing|gate|review|precommit)/i,
      /treat[^.\n]{0,40}(mirror|stored)[^.\n]{0,60}as (authoritative|current|valid|binding)/i,
    ]) {
      assert.ok(
        !claim.test(body),
        `${label} lets a stored or mirrored verdict close a gate (matched ${claim}); `
          + 'the mirror records that a gate passed, never which tree passed it',
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
  "### Step 4: Execute the correction — in the same reply The output above is the traceability ",
  "record, not the deliverable. Immediately after printing it, invoke the correction through ",
  "the Skill tool (`Skill: /codex-review-fast`) and report what it returned. A findings table ",
  "followed by a stop is the exact failure this skill exists to correct — see § Execution ",
  "Contract, which this step is the operational half of. **Every owed correction, not the first ",
  "one.** Two rows can fire at once — a degraded dirty tree owes both `/codex-review-fast` and ",
  "`/codex-review-doc` — and stopping after one leaves the other plane open, which is the same ",
  "defect in a smaller shape. Run them one at a time and **re-read Step 1 after each**: a ",
  "review that edits files moves the tree, so the remaining plan computed before it may no ",
  "longer be the right one. **Detection 4 is advisory and has no correction Skill.** Being on ",
  "`main` is corrected by creating a branch, and `@rules/git-workflow.md` does not authorize ",
  "this skill to run `git checkout`/`switch` — nor is there a branch name to choose. State the ",
  "finding and the command the human can run; that is the whole of it. If detection 4 is the ",
  "*only* finding, this step ends without an invocation. **A degraded run terminates too, and ",
  "not by claiming All Clear.** Without the resolver there is no verdict, so re-reading Step 1 ",
  "after a correction returns the *same* rows it returned before — `/codex-review-fast` cannot ",
  "make `CODE_REVIEW` true when nothing can read a verdict. **Degradation dominates the ",
  "terminal status**: whenever `ADV_OK` is false the reply ends at `### Degraded ⚠️`, whether ",
  "or not detection 4 also fired and whether or not a correction ran. Two rules keep that from ",
  "becoming a loop or a false clearance: | Degraded run | What terminates it | ",
  "|--------------|--------------------| | An executable correction fired | Invoke **each ",
  "distinct correction at most once**. When the re-read returns rows already corrected in this ",
  "reply and the resolver is still unavailable, stop and report `### Degraded ⚠️` — the ",
  "corrections ran, closure is unverifiable until the resolver answers | | No executable ",
  "correction fired | Report `### Degraded ⚠️` as well, naming the resolver as the missing ",
  "input. **Not `### All Clear ✅`**, and **not the lone-detection-4 exception either**: ",
  "detection 4 fires on a degraded clean run on `main` and names no Skill, so that run reaches ",
  "the end with no invocation and must still not claim a clearance nothing verified | So the ",
  "complete list of outcomes that end this step without an invocation is **three**: `### All ",
  "Clear ✅` (the resolver answered and nothing is owed), a lone detection 4 on a run the ",
  "resolver answered, and `### Degraded ⚠️` where no executable correction fired. A degraded ",
  "run that *did* invoke corrections ends at `### Degraded ⚠️` too — that one is a termination, ",
  "not an exception.",
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
    "**There are exactly three exceptions, and \u00a7 Step 4 defines them.** They are not ",
    "enumerated here: this file already learned that a second copy of the lifecycle diverges ",
    "from the first within a round, so the copies were removed rather than kept in sync. What ",
    "belongs here is the part \u00a7 Step 4 does not carry \u2014 every executable owed correction is ",
    "invoked, and \"owed\" is plural: two findings means two invocations.",
  ].join('');
  // Two more surfaces state the same contract further down the file, and round 21
  // showed each can be inverted alone: the Execution Contract's item 1 ("corrections
  // may repeat indefinitely") and the Graceful Degradation rows ("only the code
  // plane"). Both kept every file-wide regex green while contradicting the blocks
  // above, so both are pinned as normalized closed clauses too.
  // Step 2's degraded table is the last surface that still states a terminal outcome
  // in its own words, and round 22 inverted it alone — "Only row 1 fires" — with all 65
  // tests green. It is small and normative, so it is pinned; the checklist, being pure
  // restatement, was deleted instead. The correct-flow block was pinned here for the
  // same reason until doc round 5, which removed its terminal lines: it now defers to
  // § Step 4, so CORRECT_FLOW_EXACT pins a deferral rather than a copy.
  const STEP2_DEGRADED_EXACT = [
    [
      "| Tree provably clean | All three `false` \u2014 no source for them | No **gate** row: rows ",
      "1 and 2 need a change flag, row 3 needs `CODE_REVIEW=true`, row 5 needs `DIRTY`. Row 4 ",
      "is unaffected \u2014 it reads `BRANCH`, not the resolver, so a degraded clean run on `main` ",
      "still reports it, and the run still terminates under \u00a7 Step 4 |",
    ].join(''),
    [
      "| Tree dirty or unverifiable | All three `false` \u2014 no source for them | Rows 1 and 2 ",
      "both fire; row 5 too when no state file exists. Row 3 cannot, because `CODE_REVIEW` is ",
      "`false` |",
    ].join(''),
  ];
  const step2Rows = tableRows(skill, '| Degraded run | Verdicts | What fires |');
  assert.deepEqual(
    step2Rows, STEP2_DEGRADED_EXACT,
    "Step 2's degraded table changed — re-derive STEP2_DEGRADED_EXACT and check both planes still open",
  );

  const CORRECT_FLOW_EXACT = [
    "/remind \u2192 detect doc-no-review \u2192 output findings table \u2192 invoke Skill(/codex-review-doc) \u2192 report result",
    "/remind \u2192 detect code-no-review \u2192 output findings table \u2192 invoke Skill(/codex-review-fast) \u2192 report result",
    "/remind \u2192 nothing to invoke \u2192 the outcome that terminates the run is \u00a7 Step 4's to name",
  ];
  assert.deepEqual(
    skill.slice(skill.indexOf('**Correct flow**:')).split('```')[1].trim().split('\n').map((l) => l.trim()),
    CORRECT_FLOW_EXACT,
    'the correct-flow block changed — re-derive CORRECT_FLOW_EXACT and check no run claims a clearance it did not earn',
  );

  const EC_ITEM1_EXACT = [
    "1. **Invoke the correction Skill for every executable owed finding, immediately** in the ",
    "same reply \u2014 do not ask for permission, do not output a summary and stop. Two findings ",
    "means two invocations, Step 1 re-read between them. Which runs end without an ",
    "invocation, and how a degraded run terminates, are \u00a7 Step 4's to state \u2014 there are three ",
    "exceptions and this list is not a fourth copy of them",
  ].join('');
  const ecItem1 = skill.slice(skill.indexOf('1. **Invoke the correction Skill')).split('\n2. **Re-read')[0];
  assert.equal(
    ecItem1.replace(/\s+/g, ' ').trim(), EC_ITEM1_EXACT,
    'Execution Contract item 1 changed — re-derive EC_ITEM1_EXACT and check it still agrees with Step 4',
  );

  const GD_ROWS_EXACT = [
    [
      "| jq unavailable | The resolver's answer cannot be parsed, so the run degrades to the two rows ",
      "below \u2014 fail-closed, never silently clean |",
    ].join(''),
    [
      "| Resolver unavailable, tree provably clean | Change flags read `false`, verdicts read `false` ",
      "(the mirror is never read \u2014 a clean tree does not bind a stored verdict to itself), so no gate ",
      "row fires; detection 4 still can, reading `BRANCH`. The run terminates under \u00a7 Step 4, ",
      "which refuses a clearance for a run that verified nothing |",
    ].join(''),
    [
      "| Resolver answered from anything but a derived read (`treeState` other than `ok`, or a ",
      "`mirror_planes` that is not an **empty array** \u2014 a non-empty array, a missing field, `null`, ",
      "`\"\"` and `{}` are all rejected, since jq gives the last two length zero) | Rejected exactly ",
      "like no answer at all \u2014 it carries the stored verdicts this step refuses to read directly. The ",
      "rows below apply |",
    ].join(''),
    [
      "| Resolver unavailable, tree dirty or unverifiable | **Both** planes open and all three ",
      "verdicts read `false`. Rows 1 and 2 fire, row 5 when no state file exists; **row 3 cannot ",
      "fire** \u2014 its trigger is `CODE_REVIEW=true`. Disclose the shared cause once |",
    ].join(''),
    [
      "| State file missing | Not a degradation: the resolver derives from tree content and ",
      "content-addressed receipts, so gates can still close. It only sets `STATE_FILE_EXISTS=false`, ",
      "which is detection 5's input |",
    ].join(''),
    "| Rule file not found | List available rules via `Glob(\"rules/*.md\")` |",
  ];
  const gdRows = tableRows(skill, '| Failure | Behavior |');
  assert.deepEqual(
    gdRows, GD_ROWS_EXACT,
    'the Graceful Degradation resolver rows changed — re-derive GD_ROWS_EXACT and check both planes still open',
  );

  // Doc review round 5: the resolver comment claimed the ladder bounds the call the
  // way the advisory hooks bound theirs. The last rung runs node with no bounding tool
  // at all, so on a host without timeout/gtimeout/perl nothing is bounded — and the
  // git probe never was. The comment is what a reader trusts before reading the shell.
  // Round 30 killed the first version of this pin: requiring the three phrases left
  // `runs node unbounded (which is false)` green, because a substring pin cannot refuse
  // a sentence that carries its own negation. So the whole comment block is closed and
  // compared, the way the spec rows are — nothing can be appended to it unnoticed.
  const BOUND_COMMENT_EXACT = [
    "# Bounded like the advisory hooks *when a bounding tool exists*: the derivation ",
    "# hashes dirty and untracked content, which is unbounded on a pathological tree, ",
    "# and /remind runs interactively. A kill lands in the fallback below. With none of ",
    "# timeout/gtimeout/perl present the last branch runs node unbounded \u2014 the ladder ",
    "# has no pure-shell rung, and claiming otherwise is the overstatement doc review ",
    "# round 5 caught. The `git status` probe above is unbounded for the same reason.",
  ].join('');
  const boundAt = skill.indexOf('# Bounded');
  assert.notEqual(boundAt, -1, 'the resolver comment no longer opens with the pinned lead-in');
  const boundComment = [];
  for (const line of skill.slice(boundAt).split('\n')) {
    if (!line.trim().startsWith('#')) break;
    boundComment.push(line.trim());
  }
  assert.equal(
    boundComment.join(' '), BOUND_COMMENT_EXACT,
    'the resolver boundedness comment changed — re-derive BOUND_COMMENT_EXACT and re-read the ladder below it',
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
  // of this loop missed: it mapped resolver-answered to All Clear and
  // resolver-unavailable to Degraded on its own, so a Step 4 change needed syncing
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
  // Round-17 finding: the shell discarded every mirror verdict on a moved tree while
  // three prose surfaces still said the verdicts are read whenever the resolver is
  // unavailable, and that rows 1 and 2 stay separable there. A model reading those
  // discloses `source=mirror` for a value that was never used. The split is one
  // sentence in each surface, so pin the split, not the sentence.
  const surfaces = [
    ['SKILL.md', readFileSync(skillPath, 'utf8')],
    ['detection-rules.md', readFileSync(resolve(root, 'skills/remind/references/detection-rules.md'), 'utf8')],
    ['2-tech-spec.md', readFileSync(resolve(root, 'docs/features/remind/2-tech-spec.md'), 'utf8')],
  ];

  for (const [label, body] of surfaces) {
    assert.match(
      body,
      /mirror is \*{0,2}(never|not)\*{0,2} read|(never|not) read (on any|on a) degraded run|no verdicts? at all/i,
      `${label} must state that a degraded run reads no verdict from the mirror`,
    );
    assert.match(
      body,
      /clean tree included|however clean|clean `?git status`? (does not|cannot)|equally clean commit|commit A/i,
      `${label} must say why a clean tree is not the binding either`,
    );
    assert.match(
      body,
      /(detection|row) ?3 cannot|cannot fire/i,
      `${label} must state the cost: detection 3 cannot fire on a degraded run`,
    );
    // Detection 4 reads `BRANCH`, never the resolver, so "nothing fires on a clean
    // degraded run" is false on `main` — and it is the sentence that lets a reader
    // treat such a run as the lone-detection-4 exception instead of Degraded.
    assert.match(
      body,
      /[Rr]ow 4 (is unaffected|still can)|detection 4 (reads|fires|can)/,
      `${label} must say detection 4 is unaffected by the resolver being unavailable`,
    );
    assert.ok(
      !/Nothing — no change flag/.test(body),
      `${label} still claims a degraded clean run fires nothing at all`,
    );
    // A surface can carry the right sentence and a contradicting one at the same
    // time, and the model obeys whichever it reads last — so the correct claims
    // above are paired with a refusal of every wrong one. Both survivors of this
    // round's mutation pass were exactly that shape.
    // The two rules a reader most needs and cannot re-derive: which answers the
    // step accepts, and how a degraded run ends. The reference file describes the
    // detection table only, so it is exempt from both.
    // The reference is where a reader looks up what the verdict fields mean, so it
    // is the surface most likely to describe the resolver's raw merge and leave the
    // consumer-side refusal implicit — which is how round 21's mutant deleted the
    // whole sentence without failing anything.
    if (label === 'detection-rules.md') {
      assert.match(
        body,
        /not what this consumer accepts[\s\S]{0,240}`mirror_planes` is an empty\narray\)\. Any mirror-backed answer is refused like no answer at all and the run degrades\./,
        'the reference must say Step 1 accepts verdicts only from a derived read, and refuses the rest',
      );
    }

    if (label !== 'detection-rules.md') {
      assert.match(body, /mirror_planes/, `${label} must record the provenance clause the resolver answer is checked against`);
      assert.match(body, /treeState/, `${label} must name the other half of that clause`);
      assert.match(body, /at most once/i, `${label} must state that a degraded run invokes each correction once`);
      assert.match(body, /### Degraded ⚠️|`?Degraded ⚠️`?/, `${label} must name the outcome that terminates a degraded run`);
    }

    // Token presence is not the claim. Round 20 rewrote the provenance row to
    // "accept when `treeState=not-a-repo` or `mirror_planes` is non-empty" and
    // inverted the degraded paragraph — both kept every token above, and both
    // passed. SKILL.md's Step 4 is pinned verbatim in its own test; the spec's two
    // operative passages are pinned verbatim here for the same reason.
    if (label === '2-tech-spec.md') {
      const SPEC_PARA = [
        "**Degraded runs terminate explicitly.** Without a verdict source, re-reading Step 1 ",
        "after a correction returns the same rows, so `/remind` invokes each distinct correction ",
        "**at most once** and the run then terminates whether or not a correction fired \u2014 a clean ",
        "tree with no readable verdict verified nothing, so no clearance is available to it. ",
        "**Degradation dominates the terminal status**, which is what keeps the lone-detection-4 ",
        "exception from swallowing it: detection 4 reads `BRANCH`, not the resolver, so a degraded ",
        "clean run on `main` does fire a row and still has no Skill to invoke, and it terminates ",
        "the same way. Which outcomes end a run without an invocation is enumerated in ",
        "`skills/remind/SKILL.md` \u00a7 Step 4 and deliberately not repeated here \u2014 the same reason ",
        "\u00a7 3.1's graph stops at the delegation node.",
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
          "| `_remind_git()` fence | Unsets the whole `GIT_*` namespace in a subshell, then `git -C ",
          "\"$PWD\"` | A named subset leaves `GIT_CEILING_DIRECTORIES`, `GIT_DIR`, `GIT_CONFIG*` able to ",
          "redirect or blind the read \u2014 and a blinded read looks exactly like a clean repository |",
        ].join(''),
        [
          "| `ROOT` | `rev-parse --show-toplevel`, else `$PWD` | `/remind` runs from wherever the ",
          "session is; a cwd-relative state file or library path degrades an answerable run in ",
          "`packages/app/` |",
        ].join(''),
        [
          "| Resolver call | `gate-derive.js --advisory`, installed copy first, bounded by a timeout ",
          "ladder **when one of `timeout`/`gtimeout`/`perl` exists** \u2014 the last rung runs node ",
          "unbounded | The stored change flags were deleted in WB5c; reading them would report \"no ",
          "change\" on a dirty tree. All five fields or none \u2014 a partial answer must not mix two ",
          "policies |",
        ].join(''),
        [
          "| Answer provenance | Accepted only when `treeState` is `ok` **and** `mirror_planes` is an ",
          "empty **array** (the type is checked: jq gives `\"\"` and `{}` length zero too, round 20); ",
          "anything else is rejected like no answer at all | `resolveAdvisory()` keeps the mirror ",
          "authoritative outside a repository (`treeState=not-a-repo`), where no digest receipt has a ",
          "tree to bind to. Those are the same stored verdicts Step 1 refuses to read directly, so ",
          "accepting them here would readmit a forged state file by a longer route (round 19) |",
        ].join(''),
        [
          "| The tree probe | **One** whole-tree `status --porcelain=v1 -uall ",
          "--ignore-submodules=none`, run unconditionally. Anything but a clean, quiet, zero-exit ",
          "answer sets `DIRTY` \u2014 to the captured output whenever that capture is non-empty (the probe ",
          "runs under `2>&1`, so stdout and stderr arrive merged and `DIRTY` can carry either or both), ",
          "and to the literal `unverifiable` only when the capture is empty, the ",
          "nonzero-exit-with-no-output case. It opens **both** planes only on the branch that cannot ",
          "classify \u2014 a rejected or unavailable resolver answer; a derived answer keeps its own ",
          "per-plane verdict, dirty tree included | It does not classify: an ordinary pathspec is ",
          "cwd-relative, and a per-plane guess that is wrong hides a gate. It is asked once because two ",
          "probes can disagree \u2014 a concurrent editor, a racy wrapper \u2014 and classifying from one while ",
          "reporting `DIRTY` from the other minted a false clearance over a moved tree (round 17) |",
        ].join(''),
        [
          "| The verdicts, degraded | Not read from anywhere: `CODE_REVIEW`/`DOC_REVIEW`/`PRECOMMIT` ",
          "are `false` whenever the resolver did not answer | The state file's contents are never read ",
          "here \u2014 only its existence, for detection 5. A clean tree does not bind a stored verdict to ",
          "itself, so trusting one there let a commit-A PASS close a gate on commit B (round 18) |",
        ].join(''),
        [
          "| `BRANCH` | Same fence, `\\|\\| BRANCH=\"\"` | A different question, so a separate read; a ",
          "redirected environment must not report a feature branch as `main`, and the guard keeps a ",
          "`set -e` caller alive to reach the cleanup line |",
        ].join(''),
      ];
      assert.deepEqual(
        tableRows(body, '| Part | What it does | Why |'), IMPL_TABLE_EXACT,
        'the \u00a7 3.3 implementation table changed \u2014 re-derive IMPL_TABLE_EXACT and read each row against SKILL.md Step 1',
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
      // reading "On a resolver failure, print `### All Clear ✅`" injected beside them
      // left all three assertions green. The fenced block is compared whole.
      const OUTPUT_BLOCK_EXACT = [
        "markdown", "## Reminder", "", "### Findings", "",
        "| # | Priority | Rule | Issue | Correction |",
        "|---|----------|------|-------|------------|",
        "| 1 | P0 | auto-loop | Code changed but review not passed | Run `/codex-review-fast` |",
        "| 2 | P1 | git-workflow | Working on main branch | Create feature branch |", "",
        "### Corrections (copy-pasteable)",
        "1. `/codex-review-fast`",
        "2. `git checkout -b feat/my-feature`", "",
        "### All Clear \u2705",
        "(the resolver answered **and** there are no findings \u2014 never on a degraded run)", "",
        "### Degraded \u26a0\ufe0f",
        "(the resolver did not answer: nothing was verified, so no clearance is claimed)",
      ];
      // Round 32: closing the fence is not closing the section. A sentence placed after
      // the fence and before \u00a7 3.5 \u2014 "a resolver failure with no listed finding reports
      // `### All Clear \u2705`" \u2014 left the fence byte-identical. The section is compared whole,
      // so the fence and every line around it are one closed unit.
      const SECTION_34_EXACT = ['### 3.4 Output Format', '', '```markdown']
        .concat(OUTPUT_BLOCK_EXACT.slice(1))
        .concat(['```']);
      const sec34 = body
        .slice(body.indexOf('### 3.4'), body.indexOf('### 3.5'))
        .split('\n')
        .map((l) => l.replace(/\s+$/, ''));
      while (sec34.length && sec34[sec34.length - 1] === '') sec34.pop();
      assert.deepEqual(
        sec34, SECTION_34_EXACT,
        'the \u00a7 3.4 output section changed \u2014 re-derive SECTION_34_EXACT and check All Clear is still refused on a degraded run',
      );
    }

    for (const stale of [
      /verdicts are read from the mirror, unreconciled/i,
      /rows 1 and 2 still fire independently/i,
      /nothing (has )?moved under (them|the mirror)/i,
      /rows? 1, 2 and 3 all fire/i,
      /row 3 fires/i,
      /\bmirror is read\b/i,
      /read (from )?the mirror (on|whenever|if)[^.\n]{0,30}clean/i,
    ]) {
      assert.ok(!stale.test(body), `${label} still describes a superseded fallback`);
    }
  }
});

test('remind rule and nuclear modes read the resolver, not the state file directly', () => {
  // A stored verdict is not bound to the tree that earned it: `/remind auto-loop`
  // reading `code_review.passed` off the mirror reports compliance over an edit made
  // after the receipt. Both modes must go through Step 1, and say why — a bare
  // mention of "Step 1" survives a rewrite that mentions it and then reads the
  // mirror anyway.
  const skill = readFileSync(skillPath, 'utf8');
  const modes = skill.slice(skill.indexOf('## Specific Rule Mode'), skill.indexOf('## Arguments'));
  const specific = modes.slice(0, modes.indexOf('## Nuclear Mode'));
  const nuclear = modes.slice(modes.indexOf('## Nuclear Mode'));

  assert.ok(!/state file \+ git/i.test(modes), 'a mode still names the state file as its detection source');
  assert.match(specific, /Step 1/, 'specific-rule mode must route its check through Step 1');
  assert.match(specific, /Not the state file directly/, 'and say so, rather than leaving Step 1 a decorative mention');
  assert.match(nuclear, /Step 1/, 'nuclear mode must route its cross-reference through Step 1');
  assert.match(nuclear, /not a second source of truth|never the state file/i, 'with the same reason stated');
});

test('remind detection rules name the resolver fields rather than the retired state keys', () => {
  const detection = readFileSync(resolve(root, 'skills/remind/references/detection-rules.md'), 'utf8');
  const conditions = detection
    .split('\n')
    .filter((l) => /^\| \d+ \| `[a-z-]+` \|/.test(l))
    .map((l) => l.split('|')[4].trim());

  assert.deepEqual(conditions.slice(0, 3), [
    '`has_code_change=true` + `code_review_passed=false`',
    '`has_doc_change=true` + `doc_review_passed=false`',
    '`code_review_passed=true` + `precommit_passed=false`',
  ]);
});

test('remind pre-authorizes the node invocation its detection step makes', () => {
  const frontmatter = readFileSync(skillPath, 'utf8').split('---')[1];
  assert.match(frontmatter, /Bash\(node:\*\)/, 'Step 1 runs node directly; without this the skill stops for approval');
});
