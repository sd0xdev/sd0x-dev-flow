// Issue #9 — the plugin-defers-to-local arbitration block fired ZERO times, not twice.
//
// The block's three original conditions (CLAUDE_PROJECT_DIR set, no dev-mode hooks.json, a local
// copy of `basename "$0"` is executable) are ALL satisfied by the local copy itself, because
// `basename "$0"` identifies WHICH HOOK this is and never WHICH COPY. So the local copy deferred
// to itself, the plugin copy deferred to the local one, and the hook never ran at all — the exact
// inverse of the double-fire the block exists to prevent, and silent.
//
// At the time (pre-lightweighting) that made every downstream guarantee fail open — the then
// fail-closed sidecar was never written by a hook that did not execute, and strict mode did not
// help because stop-guard deferred too. The enforcement layer has since retired, but the defect
// class survives it: a reminder hook that defers to itself is a silent zero-fire all the same.
//
// `pre-edit-guard.sh` is the behavioural probe throughout: it has the cleanest observable of the
// seven — a blocked `.env` edit exits 2 and prints, a deferral exits 0 in silence — so "did the
// hook run" is read off the exit code rather than inferred from a state file.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  symlinkSync,
  readFileSync,
  rmSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const hooksDir = resolve(__dirname, '../../hooks');
const PROBE = 'pre-edit-guard.sh';
const ARBITRATED_HOOKS = [
  'post-compact-auto-loop.sh',
  'user-prompt-review-guard.sh',
  'stop-guard.sh',
  'post-skill-auto-loop.sh',
  'pre-edit-guard.sh',
  'post-edit-format.sh',
];

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// A project with a local copy of the probe installed and registered, and deliberately NO
// hooks/hooks.json at the root — that file is the dev-mode bypass, and its presence would skip
// arbitration entirely and make every assertion below vacuous.
function makeProject({ register = true, projectDir = null } = {}) {
  const dir = projectDir || makeTempDir('sd0x-arb-project-');
  const localHooks = join(dir, '.claude', 'hooks');
  mkdirSync(localHooks, { recursive: true });
  copyFileSync(join(hooksDir, PROBE), join(localHooks, PROBE));
  chmodSync(join(localHooks, PROBE), 0o755);
  writeFileSync(
    join(dir, '.claude', 'settings.json'),
    JSON.stringify(
      register
        ? { hooks: { PreToolUse: [{ hooks: [{ command: `$CLAUDE_PROJECT_DIR/.claude/hooks/${PROBE}` }] }] } }
        : { hooks: {} },
    ),
  );
  return { dir, localCopy: join(localHooks, PROBE) };
}

// A separate directory standing in for the installed plugin — the copy that SHOULD defer.
function makePluginCopy() {
  const dir = makeTempDir('sd0x-arb-plugin-');
  const pluginHooks = join(dir, 'hooks');
  mkdirSync(pluginHooks, { recursive: true });
  copyFileSync(join(hooksDir, PROBE), join(pluginHooks, PROBE));
  chmodSync(join(pluginHooks, PROBE), 0o755);
  return join(pluginHooks, PROBE);
}

// Exit 2 = the guard ran and rejected. Exit 0 with no stderr = it deferred and never looked.
function runProbe(hookPath, projectDir, pluginRoot = '') {
  return spawnSync('bash', [hookPath], {
    input: JSON.stringify({ tool_input: { file_path: '.env' } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
}

test('#9: the LOCAL copy runs instead of deferring to itself', () => {
  const { dir, localCopy } = makeProject();
  const result = runProbe(localCopy, dir);

  // This is the regression. Before the fix the local copy satisfied every condition and exited 0,
  // so nothing anywhere executed the guard.
  assert.equal(result.status, 2, 'the local copy must execute, not defer to its own path');
  assert.match(result.stderr, /Blocked sensitive file/);
});

test('#9: the PLUGIN copy still defers when a local copy is installed and registered', () => {
  const { dir } = makeProject();
  const result = runProbe(makePluginCopy(), dir);

  // The other half of the contract: fixing zero-fire must not reintroduce double-fire.
  assert.equal(result.status, 0, 'the plugin copy defers to the registered local copy');
  assert.equal(result.stderr, '', 'and does so silently, without evaluating the edit');
});

test('#9: the plugin copy RUNS when the local copy is not registered in settings', () => {
  const { dir } = makeProject({ register: false });
  const result = runProbe(makePluginCopy(), dir);

  // An unregistered local copy is never invoked by the harness, so deferring to it would be the
  // zero-fire bug wearing a different hat.
  assert.equal(result.status, 2, 'nothing else would run, so the plugin copy must');
});

test('#9: a symlinked .claude does not make the local copy defer to itself', () => {
  // `pwd -P` resolves symlinks precisely so that the two sides of the comparison are compared as
  // real paths. Without it, invoking the local copy through a symlinked `.claude` yields a
  // lexically different directory, the guard reads "I am not the local copy", and the original
  // zero-fire returns for exactly the users who symlink their config.
  const real = makeTempDir('sd0x-arb-real-');
  const realHooks = join(real, 'hooks');
  mkdirSync(realHooks, { recursive: true });
  copyFileSync(join(hooksDir, PROBE), join(realHooks, PROBE));
  chmodSync(join(realHooks, PROBE), 0o755);

  const dir = makeTempDir('sd0x-arb-symlink-');
  symlinkSync(real, join(dir, '.claude'));
  writeFileSync(
    join(real, 'settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: `$CLAUDE_PROJECT_DIR/.claude/hooks/${PROBE}` }] }] } }),
  );

  const viaSymlink = runProbe(join(dir, '.claude', 'hooks', PROBE), dir);
  assert.equal(viaSymlink.status, 2, 'invoked through the symlink, the local copy still runs');

  const viaRealPath = runProbe(join(realHooks, PROBE), dir);
  assert.equal(viaRealPath.status, 2, 'and through its real path as well');
});

test('#9: dev-mode bypass — hooks/hooks.json at the project root skips arbitration', () => {
  const { dir } = makeProject();
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'hooks', 'hooks.json'), '{}');

  assert.equal(
    runProbe(makePluginCopy(), dir).status,
    2,
    'in the plugin source repo every copy runs; arbitration is not consulted',
  );
});

test('#9: with CLAUDE_PROJECT_DIR unset the hook runs unconditionally', () => {
  const result = spawnSync('bash', [makePluginCopy()], {
    input: JSON.stringify({ tool_input: { file_path: '.env' } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
  });
  assert.equal(result.status, 2, 'no project dir means no local copy to defer to');
});

// Structural pin. The behavioural tests above exercise one hook; this one is why the other six
// cannot silently regress. The fix is a copy-paste block across seven files, which is precisely
// the shape that drifts when one of them is edited in isolation.
test('#9: every arbitrated hook decides deferral by ORIGIN, with the resolved-path fallback', () => {
  const missing = [];
  for (const name of ARBITRATED_HOOKS) {
    const body = readFileSync(join(hooksDir, name), 'utf8');
    const hasSelfDir = body.includes('_SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)"');
    const hasLocalDir = body.includes('_LOCAL_DIR="$(cd "${CLAUDE_PROJECT_DIR:-/nonexistent}/.claude/hooks" 2>/dev/null && pwd -P)"');
    const comparesThem = body.includes('"$_SELF_DIR" != "$_LOCAL_DIR"');
    // The origin test must stay LEXICAL — `dirname "$0"`, not `$_SELF_DIR`. Swapping in the
    // resolved path resolves a symlinked local copy into the plugin directory and brings the
    // zero-fire straight back, which no other assertion in this file would notice.
    const lexicalOrigin = body.includes('case "$(dirname "$0")/" in "${CLAUDE_PLUGIN_ROOT%/}"/hooks/) _IS_PLUGIN_COPY=true ;; esac');
    // ...and it must match the plugin's hooks directory EXACTLY. The descendant form below reads
    // as a tighter-looking version of the same idea, but it also classifies a project nested under
    // the plugin root as the plugin's own copy — zero-fire again, in a layout the behavioural
    // tests below now cover. Pinned as a negative so the two can never be swapped back.
    const descendantOrigin = body.includes('"${CLAUDE_PLUGIN_ROOT%/}"/*)');
    const gatesOnOrigin = body.includes('[[ "$_IS_PLUGIN_COPY" == "true" ]]');
    if (!hasSelfDir || !hasLocalDir || !comparesThem || !lexicalOrigin || descendantOrigin || !gatesOnOrigin) {
      missing.push(name);
    }
  }
  assert.deepEqual(missing, [], 'these hooks would defer to themselves, or double-fire under a symlink');
});

// === Project nested under the plugin root ===
//
// The layout a descendant match gets wrong. `hooks/hooks.json` registers exactly
// `${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh`, so anything deeper under the root is somebody else's
// file — including a project that happens to live there, whose `.claude/hooks/` copy is the LOCAL
// one and must run.
function makeNestedProject() {
  const plugin = makeTempDir('sd0x-arb-plugin-nested-');
  const pluginHooks = join(plugin, 'hooks');
  mkdirSync(pluginHooks, { recursive: true });
  copyFileSync(join(hooksDir, PROBE), join(pluginHooks, PROBE));
  chmodSync(join(pluginHooks, PROBE), 0o755);

  const projectDir = join(plugin, 'examples', 'app');
  mkdirSync(projectDir, { recursive: true });
  const { localCopy } = makeProject({ projectDir });
  return { pluginRoot: plugin, pluginCopy: join(pluginHooks, PROBE), projectDir, localCopy };
}

test('#9: a project nested under the plugin root — the local copy still runs', () => {
  const { pluginRoot, projectDir, localCopy } = makeNestedProject();

  const result = runProbe(localCopy, projectDir, pluginRoot);

  assert.equal(
    result.status,
    2,
    'the local copy sits under the plugin root by accident of layout, not by registration — a descendant match makes it defer to itself and nothing runs',
  );
});

test('#9: a project nested under the plugin root — the plugin copy still defers', () => {
  const { pluginRoot, pluginCopy, projectDir } = makeNestedProject();

  const result = runProbe(pluginCopy, projectDir, pluginRoot);

  assert.equal(result.status, 0, 'the registered plugin copy must still hand off to the local one');
  assert.equal(result.stderr, '', 'a deferral is silent — any output means the guard ran');
});

// === Origin-based deferral ===
//
// The resolved-path comparison alone cannot separate the two copies when `.claude/hooks` is a
// SYMLINK to the plugin's own hooks directory: both invocations resolve to one directory, both read
// "I am the local copy", neither defers, and every hook runs twice — which for the review-state
// hook means each round is counted twice against the cap. `CLAUDE_PLUGIN_ROOT` is the origin signal
// `hooks/hooks.json` already registers against, and it survives the symlink.
function makeSymlinkedInstall() {
  // The layout the path comparison cannot resolve: one physical hooks dir, reachable as both the
  // plugin's and the project's.
  const plugin = makeTempDir('sd0x-arb-plugin-shared-');
  const pluginHooks = join(plugin, 'hooks');
  mkdirSync(pluginHooks, { recursive: true });
  copyFileSync(join(hooksDir, PROBE), join(pluginHooks, PROBE));
  chmodSync(join(pluginHooks, PROBE), 0o755);

  const dir = makeTempDir('sd0x-arb-symlinked-install-');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  symlinkSync(pluginHooks, join(dir, '.claude', 'hooks'));
  writeFileSync(
    join(dir, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: `$CLAUDE_PROJECT_DIR/.claude/hooks/${PROBE}` }] }] } }),
  );
  return { dir, plugin, pluginCopy: join(pluginHooks, PROBE), localCopy: join(dir, '.claude', 'hooks', PROBE) };
}

test('#9: symlinked install — exactly one of the two invocations does the work', () => {
  const { dir, plugin, pluginCopy, localCopy } = makeSymlinkedInstall();

  const asPlugin = runProbe(pluginCopy, dir, plugin);
  const asLocal = runProbe(localCopy, dir, plugin);

  assert.equal(asPlugin.status, 0, 'invoked as the plugin copy it defers');
  assert.equal(asLocal.status, 2, 'invoked as the registered local copy it runs');
  // Stated as a count because the property is "exactly one", not "each behaves thus" — a future
  // change that made both defer would satisfy neither half above read separately.
  assert.equal(
    [asPlugin, asLocal].filter((r) => r.status === 2).length,
    1,
    'one physical file, two registrations, exactly one execution',
  );
});

test('#9: CLAUDE_PLUGIN_ROOT set does not make the ordinary local copy defer', () => {
  const { dir, localCopy } = makeProject();
  const plugin = makeTempDir('sd0x-arb-plugin-elsewhere-');
  assert.equal(
    runProbe(localCopy, dir, plugin).status,
    2,
    'the local copy is not under the plugin root, so it runs',
  );
});

test('#9: an invocation from neither the plugin root nor the local dir runs rather than defers', () => {
  const { dir } = makeProject();
  const plugin = makeTempDir('sd0x-arb-plugin-unrelated-');
  const stray = makeTempDir('sd0x-arb-stray-');
  copyFileSync(join(hooksDir, PROBE), join(stray, PROBE));
  chmodSync(join(stray, PROBE), 0o755);

  // Running is the safe direction whenever origin is undecidable, for the same reason the whole
  // fix exists: a wrong deferral is silent.
  assert.equal(runProbe(join(stray, PROBE), dir, plugin).status, 2);
});

// The guard must be FALSE when either side is unresolvable, so the hook runs. Stated as a test
// because the safe direction is counter-intuitive: an unresolvable path looks like a reason to
// bail out, and bailing out here means nothing runs. Double-fire is visible and recoverable;
// zero-fire is silent, which is what made #9 survive a release.
test('#9: an unresolvable local directory does NOT cause a deferral', () => {
  const { dir } = makeProject();
  rmSync(join(dir, '.claude', 'hooks'), { recursive: true, force: true });

  assert.equal(
    runProbe(makePluginCopy(), dir).status,
    2,
    'with no resolvable local hooks dir the plugin copy must run, never silently stand down',
  );
});
