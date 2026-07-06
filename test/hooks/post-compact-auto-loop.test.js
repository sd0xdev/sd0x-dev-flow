const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

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
      process.stdout.write(fieldMatch[2].trim());
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
  assert.match(result.stdout, /Declaring != Executing/, 'should re-inject rule 1');
});

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
  assert.match(result.stdout, /\/precommit/, 'should mention /precommit');
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
      current_round: 3,
      max_rounds: 10,
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
      current_round: 3,
      max_rounds: 10,
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
      current_round: 3,
      max_rounds: 10,
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
    'should inject strategic reset at threshold (7 >= 10-3)'
  );
  assert.ok(
    result.stdout.includes('Re-read original error'),
    'should include checklist items'
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
      current_round: 5,
      max_rounds: 10,
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
