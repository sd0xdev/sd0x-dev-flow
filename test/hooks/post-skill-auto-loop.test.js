const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  AMBIENT_NON_C_ENV,
  setupLocaleAwareGitBin,
  writePendingState,
} = require('./helpers/reconciliation-locale');

const hookPath = resolve(__dirname, '../../hooks/post-skill-auto-loop.sh');
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

// Minimal Node-based jq stub: supports `.field // default` extraction and the arbitration
// `contains("X")` probe. Mirrors the stub used by post-compact-auto-loop.test.js.
function setupStubBin() {
  const binDir = makeTempDir('sd0x-post-skill-bin-');
  const stubJq = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
let query;
let file;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-r') continue;
  if (arg === '-e') continue;
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
  const containsMatch = query.match(/contains\\("([^"]+)"\\)/);
  if (containsMatch) {
    const needle = containsMatch[1];
    if (JSON.stringify(data).includes(needle)) {
      process.stdout.write('true');
      process.exit(0);
    }
    process.exit(1);
  }
}
process.exit(0);
`;
  writeExecutable(join(binDir, 'jq'), stubJq);
  return binDir;
}

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
  writeFileSync(join(dir, '.claude_review_state.json'), JSON.stringify(state));
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Basic functionality ---

test('post-skill-auto-loop exits 0 and silent when no state file', () => {
  const cwd = makeTempDir('sd0x-ps-no-state-');
  const binDir = setupStubBin();
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'should produce no output without a state file');
});

test('post-skill-auto-loop silent when all gates passed', () => {
  const cwd = makeTempDir('sd0x-ps-all-passed-');
  const binDir = setupStubBin();
  setupStubGitUntrackedAware(binDir, { tracked: ' M src/app.ts' });
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: true },
    doc_review: { passed: false },
    precommit: { passed: true },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'should not inject when all gates passed');
});

test('post-skill-auto-loop injects /codex-review-fast when code review pending', () => {
  const cwd = makeTempDir('sd0x-ps-pending-');
  const binDir = setupStubBin();
  setupStubGitUntrackedAware(binDir, { tracked: ' M src/app.ts' });
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('[AUTO_LOOP]'), 'should emit [AUTO_LOOP] directive');
  assert.ok(result.stdout.includes('/codex-review-fast'), 'should require /codex-review-fast');
});

// --- Stale-state reconciliation regression (pins -uno→-uall + ||-outside-$() fixes) ---

test('reconciliation: untracked new code file surfaced by -uall → injects review', () => {
  const cwd = makeTempDir('sd0x-ps-uall-');
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
  const cwd = makeTempDir('sd0x-ps-partial-');
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

test('reconciliation: clean worktree downgrades stale has_code_change → silent', () => {
  const cwd = makeTempDir('sd0x-ps-clean-');
  const binDir = setupStubBin();
  // Empty porcelain across all modes → no pending code → one-way true→false downgrade applies.
  setupStubGitUntrackedAware(binDir, { tracked: '', untracked: '', untrackedCollapsed: '' });
  writeStateFile(cwd, {
    has_code_change: true,
    has_doc_change: false,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  });
  const result = runHook({ cwd, binDir });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'clean worktree should reconcile stale flag → silent');
});

test('reconciliation: dirty shell hook (.sh) keeps flag → injects review', () => {
  const cwd = makeTempDir('sd0x-ps-sh-');
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

test('reconciliation: dirty .ipynb keeps has_code_change → injects review', () => {
  const cwd = makeTempDir('sd0x-ps-ipynb-');
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

test('reconciliation: a NON-C-locale directory-omission warning does NOT downgrade the code flag → still emits [AUTO_LOOP] (iter-20 P1, host-independent)', (t) => {
  // Locale-aware stub git + timeout shim so the stale-state reconciliation branch fires
  // deterministically on any host (no installed zh_TW needed). Ambient LC_ALL is a non-C string:
  // a hook that forgot to force LC_ALL=C would let the stub emit its localized (non-ASCII) omission
  // warning, the English-only regex would miss it, and the empty (dir-omitted) listing would
  // downgrade has_code_change→false → no pending step → the hook stays silent (fail-open). The fix
  // forces LC_ALL=C → English warning → regex matches → UNAVAILABLE → holds the flag → emits.
  // Non-tautology anchor: reverting either the LC_ALL=C or the omission guard empties stdout.
  const binDir = makeTempDir('sd0x-post-skill-recon-bin-');
  if (!setupLocaleAwareGitBin(binDir)) {
    // `t.skip`, not a bare `return`: a silent early return reports as a PASS, so on a host
    // where the shim cannot be built this test looked like coverage it was not providing.
    t.skip('real coreutils unresolvable on this host — cannot build the locale-aware git shim');
    return;
  }
  const workDir = makeTempDir('sd0x-post-skill-recon-work-');
  writePendingState(workDir);
  const result = runHook({ cwd: workDir, binDir, env: { PATH: binDir, ...AMBIENT_NON_C_ENV } });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('[AUTO_LOOP]') && result.stdout.includes('/codex-review-fast'),
    'the hook must force LC_ALL=C so git\'s omission warning is the English form its regex matches → hold → emit, regardless of ambient locale'
  );
});
