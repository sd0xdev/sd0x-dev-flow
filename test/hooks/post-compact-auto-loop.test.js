const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
  existsSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync, spawn } = require('node:child_process');

const {
  AMBIENT_NON_C_ENV,
  setupLocaleAwareGitBin,
  writePendingState,
} = require('./helpers/reconciliation-locale');

const hookPath = resolve(__dirname, '../../hooks/post-compact-auto-loop.sh');
const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function setupStubBin() {
  const binDir = makeTempDir('sd0x-post-compact-bin-');
  const stubJq = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
let query;
let file;
let hasExitFlag = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-r') continue;
  if (arg === '-e') { hasExitFlag = true; continue; }
  if (!query) { query = arg; continue; }
  if (!file) { file = arg; continue; }
}
let input = '';
try {
  input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
} catch {}
let data = {};
try {
  data = input ? JSON.parse(input) : {};
} catch {}

// Handle field extraction: .field // default
if (query) {
  const fieldMatch = query.match(/^\\.([\\w.]+)\\s*\\/\\/\\s*(.+)$/);
  if (fieldMatch) {
    const path = fieldMatch[1].split('.');
    let val = data;
    for (const key of path) {
      val = val && val[key];
    }
    if (val === undefined || val === null) {
      // Real \`jq -r\` prints a string default UNQUOTED. Emitting the filter text verbatim handed
      // the hook \`"single"\` where production sees \`single\` — which now reads as an unrecognized
      // review_mode and fails closed to dual. A stub that is wrong in the direction of the code
      // under test is worse than no stub.
      const d = fieldMatch[2].trim();
      process.stdout.write(/^".*"$/.test(d) ? d.slice(1, -1) : d);
    } else {
      process.stdout.write(String(val));
    }
    process.exit(0);
  }
  // Handle strategic_reset_fired write
  if (query.includes('strategic_reset_fired = true')) {
    if (!data.iteration_history) data.iteration_history = {};
    data.iteration_history.strategic_reset_fired = true;
    process.stdout.write(JSON.stringify(data));
    process.exit(0);
  }
  // Handle arbitration: .. | strings | select(contains("X"))
  const containsMatch = query.match(/contains\\("([^"]+)"\\)/);
  if (containsMatch) {
    const needle = containsMatch[1];
    const str = JSON.stringify(data);
    if (str.includes(needle)) {
      process.stdout.write('true');
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}
process.exit(0);
`;
  writeExecutable(join(binDir, 'jq'), stubJq);
  return binDir;
}

function runHook({ cwd, binDir, env = {} }) {
  return spawnSync('bash', [hookPath], {
    cwd,
    input: '{}',
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: binDir ? `${binDir}:${process.env.PATH}` : process.env.PATH,
      CLAUDE_PROJECT_DIR: cwd || '',
      ...env,
    },
  });
}

function writeStateFile(dir, state) {
  writeFileSync(
    join(dir, '.claude_review_state.json'),
    JSON.stringify(state)
  );
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Basic functionality ---

test('post-compact-auto-loop exits 0 when no state file', () => {
  const cwd = makeTempDir('sd0x-pc-no-state-');
  const binDir = setupStubBin();
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0, 'should exit 0');
  assert.equal(result.stdout.trim(), '', 'should produce no output');
});

test('post-compact-auto-loop exits 0 when all passed (no output)', () => {
  const cwd = makeTempDir('sd0x-pc-all-passed-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: true },
    doc_review: { passed: false },
    precommit: { passed: true },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'should not inject when all passed');
});

// --- Stale-state reconciliation regression (pins -uno→-uall + ||-outside-$() fixes) ---

// Flag-aware git stub: -uno hides untracked (old bug), -uall lists the file (fix), plain
// --porcelain collapses a brand-new untracked dir to "?? src/" (also misses the file). Reverting
// either to -uno or to plain --porcelain makes the extension grep miss the file, so the one-way
// true→false reconciliation would silently clear the fail-closed flag and the hook stays silent.
function setupStubGitUntrackedAware(binDir, { tracked = '', untracked = '', untrackedCollapsed = '' }) {
  // Join non-empty parts with a newline so a caller setting BOTH tracked and untracked yields
  // two valid porcelain lines, not one malformed concatenated line (` M a.ts?? b.md`).
  const uallOut = [tracked, untracked].filter(Boolean).join('\n');
  const collapsedOut = [tracked, untrackedCollapsed].filter(Boolean).join('\n');
  writeExecutable(
    join(binDir, 'git'),
    `#!/bin/sh
if echo "$*" | grep -q "status --porcelain"; then
  if echo "$*" | grep -q -- "-uno"; then
    printf '%s' '${tracked}'
  elif echo "$*" | grep -q -- "-uall"; then
    printf '%s' '${uallOut}'
  else
    printf '%s' '${collapsedOut}'
  fi
  exit 0
fi
exit 1
`
  );
  // Reconciliation only runs the -uall walk under a timeout helper; install a passthrough one.
  writeExecutable(join(binDir, 'timeout'), `#!/bin/sh\nshift; exec "$@"\n`);
}

test('reconciliation: untracked new code file surfaced by -uall → injects review', () => {
  const cwd = makeTempDir('sd0x-pc-uall-');
  const binDir = setupStubBin();
  setupStubGitUntrackedAware(binDir, {
    tracked: '',
    untracked: '?? src/new-feature.ts',
    untrackedCollapsed: '?? src/',
  });
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('/codex-review-fast'),
    'untracked new .ts must keep has_code_change (−uall) → inject, not silently downgrade'
  );
});

test('reconciliation: partial git stdout on timeout-kill is discarded → injects review', () => {
  const cwd = makeTempDir('sd0x-pc-partial-');
  const binDir = setupStubBin();
  // timeout shim prints a partial, non-code porcelain line then dies (exit 124). The fixed hook
  // overwrites GIT_PORCELAIN with the exact sentinel (|| OUTSIDE $()), so reconciliation is
  // skipped → flag kept → inject. The old in-substitution `|| echo sentinel` appended the
  // sentinel to the partial line, reconciled against it (no code ext) and downgraded → silent.
  writeExecutable(join(binDir, 'timeout'), `#!/bin/sh\nprintf '%s\\n' ' M notes.txt'\nexit 124\n`);
  writeExecutable(join(binDir, 'git'), '#!/bin/sh\nexit 0\n');
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('/codex-review-fast'),
    'partial-output-on-kill must not downgrade the stale flag → inject'
  );
});

test('reconciliation: dirty shell hook (.sh) keeps flag → injects review', () => {
  const cwd = makeTempDir('sd0x-pc-sh-');
  const binDir = setupStubBin();
  // Only a .sh file is dirty. Before the fix, .sh was not a code extension, so the reconciler
  // downgraded the stale flag and stayed silent (fail-OPEN for this .sh-primary repo).
  setupStubGitUntrackedAware(binDir, { tracked: ' M hooks/x.sh' });
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('/codex-review-fast'),
    'a dirty .sh hook is code → flag kept → inject (not silently downgraded)'
  );
});

// --- Pending code review ---

test('post-compact-auto-loop injects /codex-review-fast when code review pending', () => {
  const cwd = makeTempDir('sd0x-pc-code-review-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /codex-review-fast/, 'should mention /codex-review-fast');
  assert.match(result.stdout, /AUTO_LOOP_RESUME/, 'should have resume marker');
  // R2 replaced the anchor recital with the state it was standing in for. The recital repeated
  // rules the model already carries; what compaction actually destroys is the STATE, so that is
  // what gets re-injected. The command now rides in `suggested=` — advisory, not mandated.
  assert.match(result.stdout, /pending=code_review,precommit/,
    'the outstanding planes must be named');
  assert.match(result.stdout, /suggested=\/codex-review-fast/,
    'and the entry point offered as a suggestion');
  assert.doesNotMatch(result.stdout, /Declaring != Executing/,
    'the anchor recital must not come back — R2 removed it deliberately');
  // Delivery is not enough — the fields have to survive the trip. A marker with `phase= round=/`
  // behind it reads as a signal and carries nothing, which is what an empty jq read produces.
  const line = result.stdout.split('\n').find((l) => l.startsWith('[AUTO_LOOP_RESUME]'));
  assert.ok(line, `no resume line found: ${JSON.stringify(result.stdout)}`);
  assert.match(line, /\bphase=\S+/, `phase rendered empty: ${JSON.stringify(line)}`);
  assert.match(line, /\bround=\d+\/\d+\b/, `round/cap rendered empty: ${JSON.stringify(line)}`);
  assert.match(line, /\btier=(fast|standard|thorough)\b/, `tier rendered empty: ${JSON.stringify(line)}`);
});

// Aggregate routing was previously tested only through post-skill-auto-loop, leaving compaction —
// the one hook whose whole job is restoring state the model just lost — unexercised.
for (const [label, mode] of [['dual', 'dual'], ['an unrecognized mode (fail-closed to dual)', 'duel']]) {
  test(`compaction under ${label} names the aggregate gate`, () => {
    const cwd = makeTempDir('sd0x-pc-agg-');
    const binDir = setupStubBin();
    writeStateFile(cwd, {
      has_code_change: true,
      has_doc_change: false,
      review_mode: mode,
      code_review: { passed: true },
      doc_review: { passed: false },
      precommit: { passed: false },
    });

    const result = runHook({ cwd, binDir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /pending=aggregate_gate\b/);
    assert.match(result.stdout, /suggested=\/codex-review-branch --dual/);
  });
}

// --- Pending precommit ---

test('post-compact-auto-loop injects /precommit when precommit pending', () => {
  const cwd = makeTempDir('sd0x-pc-precommit-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: true },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  // `precommit` is a strict PREFIX of `precommit-fast`, so a bare /\/precommit/ also matches the
  // reduced gate — the assertion could not tell the two apart and the emitted variant was pinned
  // nowhere. The negative lookahead makes it name the full gate specifically.
  assert.match(result.stdout, /\/precommit(?![-\w])/, 'should mention the full /precommit gate');
});

// --- Pending doc review ---

test('post-compact-auto-loop injects /codex-review-doc when doc review pending', () => {
  const cwd = makeTempDir('sd0x-pc-doc-review-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: false,
    has_doc_change: true,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /codex-review-doc/, 'should mention /codex-review-doc');
});

// --- No jq available ---

test('post-compact-auto-loop exits 0 silently when jq unavailable', () => {
  const cwd = makeTempDir('sd0x-pc-no-jq-');
  // Create a bin dir with only basic system tools but no jq
  const noJqBin = makeTempDir('sd0x-pc-nojq-bin-');
  writeExecutable(join(noJqBin, 'jq'), '#!/bin/bash\nexit 127\n');
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
  });
  const result = runHook({ cwd, binDir: noJqBin });
  assert.equal(result.status, 0, 'should exit 0');
  assert.equal(result.stdout.trim(), '', 'no output without jq');
});

// --- Arbitration: defer to local hook ---

test('post-compact-auto-loop defers to local hook when installed', () => {
  const cwd = makeTempDir('sd0x-pc-arbitration-');
  const binDir = setupStubBin();

  // Create local hook
  mkdirSync(join(cwd, '.claude', 'hooks'), { recursive: true });
  writeExecutable(
    join(cwd, '.claude', 'hooks', 'post-compact-auto-loop.sh'),
    '#!/bin/bash\necho local'
  );

  // Create settings referencing local hook
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(
    join(cwd, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: 'compact',
            hooks: [
              {
                type: 'command',
                command: '.claude/hooks/post-compact-auto-loop.sh',
              },
            ],
          },
        ],
      },
    })
  );

  // Write pending state
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
  });

  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  // Should exit early without output (deferred to local)
  assert.ok(
    !result.stdout.includes('AUTO_LOOP_RESUME'),
    'should not inject when deferring to local hook'
  );
});

// --- Dev mode: skip arbitration ---

test('post-compact-auto-loop skips arbitration in dev mode (hooks.json at root)', () => {
  const cwd = makeTempDir('sd0x-pc-dev-mode-');
  const binDir = setupStubBin();

  // Create hooks/hooks.json at root (= plugin source repo)
  mkdirSync(join(cwd, 'hooks'), { recursive: true });
  writeFileSync(join(cwd, 'hooks', 'hooks.json'), '{}');

  // Create local hook + settings (would normally trigger deferral)
  mkdirSync(join(cwd, '.claude', 'hooks'), { recursive: true });
  writeExecutable(
    join(cwd, '.claude', 'hooks', 'post-compact-auto-loop.sh'),
    '#!/bin/bash\necho local'
  );
  writeFileSync(
    join(cwd, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: 'compact', hooks: [{ command: '.claude/hooks/post-compact-auto-loop.sh' }] }],
      },
    })
  );

  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
  });

  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  // In dev mode, should NOT defer — should run and produce output
  assert.match(
    result.stdout,
    /AUTO_LOOP_RESUME/,
    'should inject in dev mode (skip arbitration)'
  );
});

// --- P1 regression: HTML comment markers must not trigger opt-in ---

test('R9+R10 default template with HTML comments does NOT trigger features', () => {
  const cwd = makeTempDir('sd0x-pc-comment-regression-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
    iteration_history: {
      // Above the checkpoint round on purpose: below it, this test would pass
      // whether or not the Think Harder gate works.
      current_round: 11,
      max_rounds: 30,
      total_rounds_session: 8,
      strategic_reset_fired: false,
    },
  });

  // Create rules dir with default template (features inside HTML comments)
  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n<!-- ## Git Memory: enabled -->\n\n<!-- ## Think Harder: enabled -->\n'
  );

  // Stub git commands
  const gitStub = `#!/bin/bash
case "$1" in
  log) echo "abc1234 feat: add feature" ;;
  diff) echo " src/main.ts | 5 ++" ;;
  status) echo " M src/main.ts" ;;
esac
`;
  writeExecutable(join(binDir, 'git'), gitStub);

  const result = runHook({ cwd, binDir, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0);
  assert.ok(
    !result.stdout.includes('[GIT_CONTEXT]'),
    'HTML-commented Git Memory should NOT trigger'
  );
  assert.ok(
    !result.stdout.includes('[STRATEGIC_RESET]'),
    'HTML-commented Think Harder should NOT trigger'
  );
});

// --- R9: Git-as-memory ---

test('R9 git context NOT injected when opt-in disabled', () => {
  const cwd = makeTempDir('sd0x-pc-r9-disabled-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
  });
  // No rules directory with "## Git Memory: enabled"
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.ok(
    !result.stdout.includes('[GIT_CONTEXT]'),
    'should NOT inject git context when disabled'
  );
});

test('R9 git context injected when opt-in enabled', () => {
  const cwd = makeTempDir('sd0x-pc-r9-enabled-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
  });

  // Create rules dir with enabled marker
  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n## Git Memory: enabled\n'
  );

  // Stub git commands
  const gitStub = `#!/bin/bash
case "$1" in
  log) echo "abc1234 feat: add feature" ;;
  diff) echo " src/main.ts | 5 ++" ;;
  status) echo " M src/main.ts" ;;
esac
`;
  writeExecutable(join(binDir, 'git'), gitStub);

  const result = runHook({ cwd, binDir, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('[GIT_CONTEXT]'),
    'should inject [GIT_CONTEXT] when enabled'
  );
});

test('R9 git context filters secret files', () => {
  const cwd = makeTempDir('sd0x-pc-r9-secrets-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
  });

  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n## Git Memory: enabled\n'
  );

  // Git stub with .env file in status
  const gitStub = `#!/bin/bash
case "$1" in
  log) echo "abc1234 feat: add .env config" ;;
  diff) echo "" ;;
  status) echo " M .env" ;;
esac
`;
  writeExecutable(join(binDir, 'git'), gitStub);

  const result = runHook({ cwd, binDir, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0);
  // The .env line should be filtered out by the secret filter
  assert.ok(
    !result.stdout.includes('.env'),
    'should filter .env from git context output'
  );
});

test('R9 git context fail-open when git unavailable', () => {
  const cwd = makeTempDir('sd0x-pc-r9-nogit-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
  });

  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n## Git Memory: enabled\n'
  );

  // Git stub that fails
  writeExecutable(join(binDir, 'git'), '#!/bin/bash\nexit 1\n');

  const result = runHook({ cwd, binDir, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0, 'should not crash when git fails');
  assert.ok(
    result.stdout.includes('[AUTO_LOOP_RESUME]'),
    'should still output auto-loop resume'
  );
});

// --- R10: Strategic Reset ---

test('R10 strategic reset NOT injected when Think Harder disabled', () => {
  const cwd = makeTempDir('sd0x-pc-r10-disabled-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
    iteration_history: {
      // Above the checkpoint round on purpose: below it, this test would pass
      // whether or not the Think Harder gate works.
      current_round: 11,
      max_rounds: 30,
      total_rounds_session: 8,
      strategic_reset_fired: false,
    },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.ok(
    !result.stdout.includes('[STRATEGIC_RESET]'),
    'should NOT inject strategic reset when disabled'
  );
});

test('R10 strategic reset injected at threshold', () => {
  const cwd = makeTempDir('sd0x-pc-r10-threshold-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
    iteration_history: {
      current_round: 11,
      max_rounds: 30,
      total_rounds_session: 7,
      strategic_reset_fired: false,
    },
  });

  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n## Think Harder: enabled\n'
  );

  const result = runHook({ cwd, binDir, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('[STRATEGIC_RESET]'),
    'should inject strategic reset at the checkpoint round (11 >= 10)'
  );
  assert.ok(
    result.stdout.includes('Cap Diagnostic Protocol'),
    'should point at the closed-set protocol in rules/auto-loop.md'
  );
  // R6: the injected content is the diagnostic taxonomy, not the old generic checklist.
  for (const cls of [
    'ARCHITECTURE',
    'DOC_TOO_LONG',
    'ATTENTION_DIFFUSION',
    'UNVERIFIED_CLAIM',
    'TIER_MISMATCH',
    'REQUIREMENT_AMBIGUITY',
  ]) {
    assert.ok(result.stdout.includes(cls), `taxonomy class ${cls} present`);
  }
  assert.ok(
    !result.stdout.includes('Re-read original error'),
    'old generic checklist is gone'
  );
  // R6 AC8: disposition lives entirely in rules/auto-loop.md — the hook may point at the
  // protocol but must not adjudicate first/second cap-hits or security-change routing itself.
  assert.ok(
    result.stdout.includes('is defined by rules/auto-loop.md'),
    'the reminder defers disposition to the rules layer'
  );
  assert.ok(
    !result.stdout.includes('escalate to human'),
    'the hook must not adjudicate escalation'
  );
  assert.ok(
    !/[Ss]econd cap-hit/.test(result.stdout),
    'first-vs-second cap-hit routing is the rules layer’s call, not the hook’s'
  );
});

test('sidecar .blocked marker forces doc review injection', () => {
  const cwd = makeTempDir('sd0x-pc-sidecar-doc-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: false,
    has_doc_change: true,
    code_review: { passed: false },
    doc_review: { passed: true },
    precommit: { passed: false },
  });
  writeFileSync(join(cwd, '.claude_review_state.json.blocked'), 'lock_failure');
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('/codex-review-doc'),
    'sidecar should force doc review injection despite doc_review.passed=true'
  );
});

test('R10 strategic reset fires only once', () => {
  const cwd = makeTempDir('sd0x-pc-r10-once-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
    iteration_history: {
      // Above the checkpoint round, so `strategic_reset_fired` is the only
      // thing keeping the injection away.
      current_round: 11,
      max_rounds: 30,
      total_rounds_session: 9,
      strategic_reset_fired: true,
    },
  });

  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n## Think Harder: enabled\n'
  );

  const result = runHook({ cwd, binDir, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0);
  assert.ok(
    !result.stdout.includes('[STRATEGIC_RESET]'),
    'should NOT inject strategic reset when already fired'
  );
});

test('reconciliation: dirty .ipynb keeps has_code_change → injects review', () => {
  const cwd = makeTempDir('sd0x-pc-ipynb-');
  const binDir = setupStubBin();
  setupStubGitUntrackedAware(binDir, { tracked: ' M analysis/model.ipynb' });
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('/codex-review-fast'),
    'notebook must count as code — flag must not downgrade to silent'
  );
});

test('reconciliation: a NON-C-locale directory-omission warning does NOT downgrade the code flag → still injects resume directive (iter-20 P1, host-independent)', (t) => {
  // Locale-aware stub git + timeout shim so the stale-state reconciliation branch fires
  // deterministically on any host (no installed zh_TW needed). Ambient LC_ALL is a non-C string:
  // a hook that forgot to force LC_ALL=C would let the stub emit its localized (non-ASCII) omission
  // warning, the English-only regex would miss it, and the empty (dir-omitted) listing would
  // downgrade has_code_change→false → NEXT empty → the hook injects NOTHING (silent fail-open). The
  // fix forces LC_ALL=C → English warning → regex matches → UNAVAILABLE → holds the flag → injects.
  // Non-tautology anchor: reverting either the LC_ALL=C or the omission guard empties stdout.
  const binDir = makeTempDir('sd0x-post-compact-recon-bin-');
  if (!setupLocaleAwareGitBin(binDir)) {
    // `t.skip`, not a bare `return`: a silent early return reports as a PASS, so on a host
    // where the shim cannot be built this test looked like coverage it was not providing.
    t.skip('real coreutils unresolvable on this host — cannot build the locale-aware git shim');
    return;
  }
  const workDir = makeTempDir('sd0x-post-compact-recon-work-');
  writePendingState(workDir);
  const result = runHook({ cwd: workDir, binDir, env: { PATH: binDir, ...AMBIENT_NON_C_ENV } });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('[AUTO_LOOP_RESUME]') && result.stdout.includes('/codex-review-fast'),
    'the hook must force LC_ALL=C so git\'s omission warning is the English form its regex matches → hold → inject, regardless of ambient locale'
  );
});

test('non-numeric max_rounds does not execute a command substitution (arithmetic injection)', () => {
  // `THRESHOLD=$(( ITER_MAX - 3 ))` is a direct arithmetic context, and bash arithmetic expands
  // command substitution inside an array subscript. `.claude_review_state.json` is an ordinary
  // working-tree file, so its values are untrusted. The hook is advisory — it only decides whether
  // to print an [ITERATION_STATE] / [STRATEGIC_RESET] hint — so the guard falls back to the schema
  // defaults rather than aborting; the enforcing decision lives in stop-guard, which fails closed.
  const workDir = makeTempDir('sd0x-compact-arith-inject-');
  const binDir = setupStubBin();
  const sentinel = join(workDir, 'ARITH_INJECTION_RAN');
  writeStateFile(workDir, {
    has_code_change: true,
    code_review: { passed: false },
    precommit: { passed: false },
    iteration_history: {
      current_round: `NEXT[$(touch ${sentinel})]`,
      max_rounds: `NEXT[$(touch ${sentinel})]`,
      total_rounds_session: `NEXT[$(touch ${sentinel})]`,
    },
  });
  mkdirSync(join(workDir, 'rules'), { recursive: true });
  writeFileSync(join(workDir, 'rules', 'auto-loop-project.md'), '## Think Harder: enabled\n');

  const result = runHook({ cwd: workDir, binDir });

  assert.equal(existsSync(sentinel), false, 'no payload from the state file may be evaluated');
  assert.equal(result.status, 0, 'the advisory hook still succeeds');
  assert.equal(
    result.stdout.includes('[ITERATION_STATE]'),
    false,
    'a rejected round falls back to 0, so no round line is printed'
  );
});

// =============================================================================
// State-file LOCK on the strategic_reset_fired write
// =============================================================================
//
// The mark is a read-modify-REPLACE (`jq … > tmp; mv tmp state`), so it rewrites the WHOLE file.
// Done outside the shared lock, it discarded anything a concurrent PostToolUse writer committed
// between the read and the rename. Losing a PASS is harmless; losing a blocking verdict restores
// the stale `passed=true` the ⛔ existed to overwrite — fail-open. These tests pin the transaction
// boundary, not the happy path.

const { readFileSync } = require('node:fs');

function thinkHarderState(cwd) {
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
    iteration_history: {
      current_round: 11,
      max_rounds: 30,
      total_rounds_session: 7,
      strategic_reset_fired: false,
    },
  });
  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n## Think Harder: enabled\n'
  );
}

test('strategic reset mark: a lock held by a LIVE owner makes the hook leave the state file untouched', () => {
  const cwd = makeTempDir('sd0x-pc-lock-held-');
  const binDir = setupStubBin();
  thinkHarderState(cwd);

  // A foreign owner that is alive and whose ts is fresh: neither arm of the stale-recovery test
  // fires, so _lock must time out and return 1. process.pid is guaranteed live for this run.
  const lockDir = join(cwd, '.claude_review_state.json.lockdir');
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'pid'), String(process.pid));
  writeFileSync(join(lockDir, 'ts'), String(Math.floor(Date.now() / 1000)));

  const statePath = join(cwd, '.claude_review_state.json');
  const before = readFileSync(statePath, 'utf8');

  const result = runHook({
    cwd, binDir,
    env: { CLAUDE_PROJECT_DIR: cwd, REVIEW_STATE_LOCK_TIMEOUT: '0' },
  });

  assert.equal(result.status, 0, 'the hook is advisory — a lost lock must not fail it');
  assert.equal(
    readFileSync(statePath, 'utf8'), before,
    'byte-identical: the hook must not replace a file another writer owns'
  );
  // The injection is skipped WITH the mark, and the direction here was deliberately flipped: this
  // used to assert the checklist still injects, on the reasoning that a repeat injection is cheap.
  // It is only cheap if the injection is otherwise correct — but outside the lock this hook cannot
  // read the flag safely, so injecting means emitting a checklist it never earned, which is the
  // repeat-firing bug rather than a tolerable cost of it. Skipping leaves the flag false, so the
  // checkpoint stays eligible and the next successful review round or compaction retries it —
  // best-effort, not guaranteed: the primary channel skips on lock contention too.
  assert.ok(
    !result.stdout.includes('[STRATEGIC_RESET]'),
    'no mark means no injection — the reminder belongs to whoever performed the false→true transition'
  );
  assert.ok(existsSync(lockDir), "the foreign owner's lock must survive");
});

test('strategic reset mark: with the lock free, the mark is written and the lock is released', () => {
  // Non-vacuity control. Without it, a hook that never wrote the mark at all would pass the test
  // above, and a hook that never released the lock would wedge every later writer for a full TTL.
  const cwd = makeTempDir('sd0x-pc-lock-free-');
  const binDir = setupStubBin();
  thinkHarderState(cwd);

  const result = runHook({ cwd, binDir, env: { CLAUDE_PROJECT_DIR: cwd } });

  assert.equal(result.status, 0);
  const state = JSON.parse(readFileSync(join(cwd, '.claude_review_state.json'), 'utf8'));
  assert.equal(state.iteration_history.strategic_reset_fired, true);
  assert.equal(
    existsSync(join(cwd, '.claude_review_state.json.lockdir')), false,
    'the lock must be released, not held until its 30s TTL'
  );
});

test('strategic reset mark: a flag flipped WHILE the hook waits for the lock suppresses the injection', async () => {
  // The negative control for the read-inside-the-lock contract, and the only one in this file that
  // a pre-lock read actually fails: every sequential test here passes just as well when the read is
  // moved back outside, because nothing changes in between. Here something does.
  //
  // The interleaving is forced, not raced. The hook is started against a lock held by a live owner
  // with a fresh ts, so neither stale-recovery arm fires and `_lock` polls (sleep 0.1) until the
  // directory disappears. While it polls we flip `strategic_reset_fired` to true — standing in for
  // the primary channel in post-tool-review-state.sh winning the race — and only then release the
  // lock. A hook that read the flag before `_lock` is holding a stale `false` and emits a checklist
  // for a cycle another process already diagnosed; a hook that reads inside sees `true` and stays
  // quiet. The assertion that the child is still running before we flip is what keeps this a
  // control rather than a coin toss: if it had already exited, the flip would be a no-op and the
  // test would pass for the wrong reason.
  const cwd = makeTempDir('sd0x-pc-lock-interleave-');
  const binDir = setupStubBin();
  thinkHarderState(cwd);

  const statePath = join(cwd, '.claude_review_state.json');
  const lockDir = join(cwd, '.claude_review_state.json.lockdir');
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'pid'), String(process.pid));
  writeFileSync(join(lockDir, 'ts'), String(Math.floor(Date.now() / 1000)));

  const child = spawn('bash', [hookPath], {
    cwd,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_PROJECT_DIR: cwd,
      // Long enough that the poll loop is still running when we flip the flag below.
      REVIEW_STATE_LOCK_TIMEOUT: '20',
    },
  });
  let stdout = '';
  child.stdout.on('data', c => { stdout += c; });
  child.stderr.on('data', () => {});
  child.stdin.end('{}');

  const exited = new Promise(res => child.on('close', code => res(code)));
  let exitedEarly = false;
  child.on('close', () => { exitedEarly = true; });

  await new Promise(res => setTimeout(res, 1200));
  assert.equal(
    exitedEarly, false,
    'the hook must still be waiting on the lock — otherwise the flip below proves nothing'
  );

  const mid = JSON.parse(readFileSync(statePath, 'utf8'));
  mid.iteration_history.strategic_reset_fired = true;
  writeFileSync(statePath, JSON.stringify(mid));
  rmSync(lockDir, { recursive: true, force: true });

  const code = await exited;
  assert.equal(code, 0, 'the hook is advisory — contention must not fail it');
  assert.ok(
    !stdout.includes('[STRATEGIC_RESET]'),
    'the flag was already true when the lock was acquired — the other channel owns this diagnosis'
  );
});

test('strategic reset mark: a STALE lock is reclaimed rather than deferred to forever', () => {
  // The TTL arm must still work here, or a crashed writer's orphaned lock would permanently
  // suppress the mark and re-inject the checklist on every single compaction.
  const cwd = makeTempDir('sd0x-pc-lock-stale-');
  const binDir = setupStubBin();
  thinkHarderState(cwd);

  const lockDir = join(cwd, '.claude_review_state.json.lockdir');
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'pid'), String(process.pid));
  writeFileSync(join(lockDir, 'ts'), String(Math.floor(Date.now() / 1000) - 120));

  const result = runHook({
    cwd, binDir,
    env: { CLAUDE_PROJECT_DIR: cwd, REVIEW_STATE_LOCK_TIMEOUT: '0' },
  });

  assert.equal(result.status, 0);
  const state = JSON.parse(readFileSync(join(cwd, '.claude_review_state.json'), 'utf8'));
  assert.equal(state.iteration_history.strategic_reset_fired, true, 'stale lock must be reclaimed');
});

test('R10 strategic reset NOT injected below the checkpoint round', () => {
  // Negative control for the threshold itself: gate enabled, flag clear, high
  // cumulative session effort — only `current_round` is below the checkpoint.
  // The near-cap form this replaced read `total_rounds_session`, and would have
  // injected here on effort spent on changes that already passed their gates.
  const cwd = makeTempDir('sd0x-pc-r10-below-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
    iteration_history: {
      current_round: 9,
      max_rounds: 30,
      total_rounds_session: 40,
      strategic_reset_fired: false,
    },
  });
  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n## Think Harder: enabled\n'
  );

  const result = runHook({ cwd, binDir, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0);
  assert.ok(
    !result.stdout.includes('[STRATEGIC_RESET]'),
    'round 9 is below the checkpoint — cumulative session effort must not substitute for it'
  );
});

test('R10 checkpoint round is configurable via AUTO_LOOP_CHECKPOINT_ROUNDS', () => {
  const cwd = makeTempDir('sd0x-pc-r10-env-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
    iteration_history: {
      current_round: 4,
      max_rounds: 30,
      total_rounds_session: 4,
      strategic_reset_fired: false,
    },
  });
  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n## Think Harder: enabled\n'
  );

  const result = runHook({
    cwd, binDir,
    env: { CLAUDE_PROJECT_DIR: cwd, AUTO_LOOP_CHECKPOINT_ROUNDS: '4' },
  });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('[STRATEGIC_RESET]'), 'round 4 meets a threshold of 4');
});

test('R10 a non-numeric AUTO_LOOP_CHECKPOINT_ROUNDS falls back to 10, never to arithmetic', () => {
  // The value reaches `[[ -ge ]]`, which expands command substitution inside an
  // array subscript — the same injection surface the digit guards above exist for.
  const cwd = makeTempDir('sd0x-pc-r10-badenv-');
  const binDir = setupStubBin();
  writeStateFile(cwd, {
    has_code_change: true,
    code_review: { passed: false },
    iteration_history: {
      current_round: 11,
      max_rounds: 30,
      total_rounds_session: 11,
      strategic_reset_fired: false,
    },
  });
  mkdirSync(join(cwd, 'rules'), { recursive: true });
  writeFileSync(
    join(cwd, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project\n\n## Think Harder: enabled\n'
  );

  const result = runHook({
    cwd, binDir,
    env: {
      CLAUDE_PROJECT_DIR: cwd,
      AUTO_LOOP_CHECKPOINT_ROUNDS: 'a[$(touch ' + join(cwd, 'pwned') + ')]',
    },
  });
  assert.equal(result.status, 0);
  assert.equal(existsSync(join(cwd, 'pwned')), false, 'no command substitution may run');
  assert.ok(result.stdout.includes('[STRATEGIC_RESET]'), 'round 11 still meets the default 10');
});

// === WB5a: derived reads (dual-read merge via resolveAdvisory) ===
// Real git + real jq (no stubs): reconciliation only ever DOWNGRADES a stored
// flag, so a resume block carrying change=code while the mirror says
// has_code_change=false can only come from the derivation reading the tree.
test('WB5a: derivation raises a false mirror flag off tree content → resume block with source=digest', () => {
  const cwd = makeTempDir('sd0x-pc-wb5a-');
  const sh = (args) => spawnSync('git', args, { cwd });
  sh(['init', '--initial-branch=main']);
  sh(['config', 'user.email', 'test@test.com']);
  sh(['config', 'user.name', 'test']);
  writeFileSync(join(cwd, 'app.js'), '// placeholder');
  sh(['add', '.']);
  sh(['-c', 'commit.gpgsign=false', 'commit', '-m', 'init']);
  // Production repos gitignore the state file; without this the untracked
  // state file is itself code-plane dirt and the assertion goes vacuous.
  writeFileSync(join(cwd, '.git', 'info', 'exclude'), '.claude_review_state.json*\n');
  writeStateFile(cwd, {
    has_code_change: false,
    has_doc_change: false,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  writeFileSync(join(cwd, 'app.js'), '// edited after the state write');

  const result = runHook({ cwd, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0);
  const line = result.stdout.split('\n').find((l) => l.startsWith('[AUTO_LOOP_RESUME]'));
  assert.ok(line, `derived obligation must surface in the resume block; got: ${JSON.stringify(result.stdout)}`);
  assert.match(line, /\bchange=code\b/);
  // WB5c: on a derivable tree a plane the digest cannot close reads false —
  // no mirror fallback, so the fact line carries no mirror_planes token.
  assert.match(line, / source=digest /);
  assert.doesNotMatch(line, /mirror_planes=/);
});

test('WB5a: clean tree lowers a true mirror flag → silent resume, no porcelain downgrade needed', () => {
  const cwd = makeTempDir('sd0x-pc-wb5a-clean-');
  const sh = (args) => spawnSync('git', args, { cwd });
  sh(['init', '--initial-branch=main']);
  sh(['config', 'user.email', 'test@test.com']);
  sh(['config', 'user.name', 'test']);
  writeFileSync(join(cwd, 'app.js'), '// placeholder');
  sh(['add', '.']);
  sh(['-c', 'commit.gpgsign=false', 'commit', '-m', 'init']);
  writeFileSync(join(cwd, '.git', 'info', 'exclude'), '.claude_review_state.json*\n');
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: true,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });

  const result = runHook({ cwd, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /\[AUTO_LOOP_RESUME\]/,
    'derived owed=false must not resurrect stale stored flags after compaction');
});

test('WB5a: missing state file no longer silences a dirty tree — derivation answers alone', () => {
  const cwd = makeTempDir('sd0x-pc-wb5a-nostate-');
  const sh = (args) => spawnSync('git', args, { cwd });
  sh(['init', '--initial-branch=main']);
  sh(['config', 'user.email', 'test@test.com']);
  sh(['config', 'user.name', 'test']);
  writeFileSync(join(cwd, 'app.js'), '// placeholder');
  sh(['add', '.']);
  sh(['-c', 'commit.gpgsign=false', 'commit', '-m', 'init']);
  writeFileSync(join(cwd, 'app.js'), '// dirty with no mirror at all');

  const result = runHook({ cwd, env: { CLAUDE_PROJECT_DIR: cwd } });
  assert.equal(result.status, 0);
  const line = result.stdout.split('\n').find((l) => l.startsWith('[AUTO_LOOP_RESUME]'));
  assert.ok(line, `a failed/deleted state write must not hide a dirty tree; got: ${JSON.stringify(result.stdout)}`);
  assert.match(line, /\bchange=code\b/);
  // WB5c: on a derivable tree a plane the digest cannot close reads false —
  // no mirror fallback, so the fact line carries no mirror_planes token.
  assert.match(line, / source=digest /);
  assert.doesNotMatch(line, /mirror_planes=/);
});
