// Regression: the sidecar plane must never resolve a symlink planted at one of its own path names.
//
// The names involved (`.claude_review_state.json.blocked*`) are FIXED, and `.gitignore` covers
// them — which means git will happily store a symlink at one of those paths while every ordinary
// `git status` stays clean. Cloning such a repo is therefore enough to arm the primitive; nothing
// has to be run first. Two distinct failures existed, in opposite directions:
//
//   DELETE  Per-event markers used to live in a `.claude_review_state.json.blocked.d/` DIRECTORY,
//           retired by session-init's orphan clear with `rm -f "$dir"/<name>`. That path resolves
//           THROUGH a symlink at `$dir` and unlinks the TARGET's file. Since the clear's
//           precondition is a CLEAN working tree, a fresh clone hits it immediately. Reproduced
//           end-to-end: every regular file in the linked directory was deleted.
//
//   WRITE   The shared `.blocked` file is appended to with `>>`, which follows a symlink and
//           writes into its target.
//
// The delete was fixed STRUCTURALLY rather than with a guard: markers became SIBLING FILES
// (`.blocked.event.<stem>`). `rm -f` on a symlink FILE unlinks the link, never its target, so the
// same accident against a sibling name destroys nothing — there is no window, unlike an `lstat`
// check on the directory, which is check-then-act. The write is refused by `_sidecar_is_marker`
// (`-f && ! -L`) and DIVERTED to a per-event marker, so refusing costs no evidence.
//
// Every test here pairs the symlink case with a control that puts a REAL file at the same path, so
// a hook that simply stopped touching the sidecar could not pass.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  lstatSync,
  symlinkSync,
  chmodSync,
  rmSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const sessionInitHook = resolve(__dirname, '../../hooks/session-init.sh');
const editHook = resolve(__dirname, '../../hooks/post-edit-format.sh');
const stopGuardHook = resolve(__dirname, '../../hooks/stop-guard.sh');

const STATE = '.claude_review_state.json';
const SHARED_SIDECAR = `${STATE}.blocked`;
const EVENT_PREFIX = `${STATE}.blocked.event.`;
const LEGACY_MARKER_DIR = `${STATE}.blocked.d`;

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

after(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// A victim directory holding files that no hook has any business touching.
function plantVictim(workDir, name = 'victim') {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'important.txt'), 'keep-me-1\n');
  writeFileSync(join(dir, 'important2.txt'), 'keep-me-2\n');
  return dir;
}

function victimIntact(dir) {
  return readdirSync(dir).sort();
}

function eventMarkers(workDir) {
  return readdirSync(workDir).filter((f) => f.startsWith(EVENT_PREFIX));
}

// ---------------------------------------------------------------------------
// session-init: the orphan clear
// ---------------------------------------------------------------------------

function runSessionInit(workDir, env = {}) {
  return spawnSync('bash', [sessionInitHook], {
    cwd: workDir,
    input: JSON.stringify({ session_id: 'new-session' }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// Seed the state file so the hook sees a session CHANGE (old session id) and takes the reset path,
// which is what reaches the sidecar clear.
function seedPriorSession(workDir) {
  writeFileSync(
    join(workDir, STATE),
    JSON.stringify({ session_id: 'old-session', code_review: { executed: true, passed: false } })
  );
}

test('CONTROL: a new session over a clean tree really does retire sidecar markers', () => {
  // Without this, every "nothing was deleted" assertion below would hold just as well against a
  // hook that stopped clearing anything at all.
  const workDir = makeTempDir('sd0x-sidecar-symlink-control-');
  seedPriorSession(workDir);
  writeFileSync(join(workDir, SHARED_SIDECAR), 'state_write_failed:code\n');
  writeFileSync(join(workDir, `${EVENT_PREFIX}1234-realmarker`), 'state_init_failed:code\n');

  const result = runSessionInit(workDir);

  assert.equal(result.status, 0);
  assert.equal(existsSync(join(workDir, SHARED_SIDECAR)), false, 'the shared marker must be retired');
  assert.deepEqual(eventMarkers(workDir), [], 'the per-event marker must be retired');
});

test('REPRODUCTION: a symlink at the legacy .blocked.d name deletes nothing', () => {
  // The historical primitive, verbatim. `ln -s ../victim .claude_review_state.json.blocked.d` in a
  // repo, then a session start over a clean tree, and both files in `victim/` were gone. The tree
  // reads as clean because a symlink carries no reviewable extension, so the clear's precondition
  // is satisfied by the attack itself.
  const workDir = makeTempDir('sd0x-sidecar-symlink-legacy-dir-');
  const victim = plantVictim(workDir);
  seedPriorSession(workDir);
  symlinkSync('victim', join(workDir, LEGACY_MARKER_DIR));
  // A genuine marker alongside it, so the clear path demonstrably RUNS during this same call.
  writeFileSync(join(workDir, SHARED_SIDECAR), 'state_write_failed:code\n');

  const result = runSessionInit(workDir);

  assert.equal(result.status, 0);
  assert.deepEqual(
    victimIntact(victim),
    ['important.txt', 'important2.txt'],
    'a symlink at the legacy marker-directory name must not become a delete primitive'
  );
  assert.equal(
    existsSync(join(workDir, SHARED_SIDECAR)),
    false,
    'non-vacuity: the clear really did run in this call — it retired the genuine marker'
  );
});

test('a symlink named as a per-event marker is ignored — never read, never deleted, target intact', () => {
  // Two independent defences, and the title used to name the weaker one. `rm -f <symlink>` unlinks
  // the LINK rather than resolving to its target — that is why siblings are safe where a directory
  // was not. But the link never reaches `rm` at all: `_sidecar_is_marker` is `[[ -f "$1" && ! -L
  // "$1" ]]`, so `_sidecar_marker_files` does not enumerate it and the retirement loop only ever
  // sees names that loop produced. The link is therefore left in place, which the old title
  // ("the link goes") asserted the opposite of while the body checked neither way.
  //
  // Left in place is the right outcome: it is not evidence — nothing this plane wrote is a symlink —
  // and deleting a file the hook has decided not to trust is a power it has no reason to hold.
  const workDir = makeTempDir('sd0x-sidecar-symlink-event-');
  const victim = plantVictim(workDir);
  seedPriorSession(workDir);
  const target = join(victim, 'important.txt');
  const plantedLink = join(workDir, `${EVENT_PREFIX}9999-planted`);
  symlinkSync(target, plantedLink);
  writeFileSync(join(workDir, SHARED_SIDECAR), 'state_write_failed:code\n');

  const result = runSessionInit(workDir);

  assert.equal(result.status, 0);
  assert.equal(readFileSync(target, 'utf8'), 'keep-me-1\n', "the link's target must be untouched");
  // The link itself survives, because it was never classified as a marker. Asserted so the two
  // defences stay distinguishable: if `_sidecar_is_marker` ever stopped rejecting symlinks, the
  // target check above would still pass (thanks to `rm -f`'s unlink semantics) and only this line
  // would notice that the hook had started acting on a file it must not trust.
  assert.equal(
    lstatSync(plantedLink).isSymbolicLink(),
    true,
    'the planted symlink must be left in place — it is not evidence, and not the hook\'s to delete'
  );
  assert.deepEqual(
    victimIntact(victim),
    ['important.txt', 'important2.txt'],
    'nothing in the linked-to directory may be removed'
  );
  assert.equal(
    existsSync(join(workDir, SHARED_SIDECAR)),
    false,
    'non-vacuity: the clear ran'
  );
});

test('a symlink at the SHARED sidecar is not evidence and its target is not deleted', () => {
  const workDir = makeTempDir('sd0x-sidecar-symlink-shared-');
  const victim = plantVictim(workDir);
  seedPriorSession(workDir);
  symlinkSync(join(victim, 'important.txt'), join(workDir, SHARED_SIDECAR));

  const result = runSessionInit(workDir);

  assert.equal(result.status, 0);
  assert.equal(
    readFileSync(join(victim, 'important.txt'), 'utf8'),
    'keep-me-1\n',
    'the target of a link planted at the shared sidecar must survive intact'
  );
  assert.deepEqual(victimIntact(victim), ['important.txt', 'important2.txt']);
});

// ---------------------------------------------------------------------------
// post-edit-format: the append
// ---------------------------------------------------------------------------

// WB5b: the edit hook no longer creates or migrates the state file, so `state_init_failed` has no
// trigger left — with no state on disk an edit owes no write at all (the gate re-opens by
// derivation). The surviving fail-closed raise is `state_write_failed:<plane>`: a state file whose
// `aggregate_gate` mirror must be reset, with the staging `mktemp` failing under it. Real `jq`
// does the parsing; only `mktemp` (and the formatter's `npx`) are shadowed.
function setupEditStubBin() {
  const binDir = makeTempDir('sd0x-sidecar-symlink-bin-');
  writeExecutable(join(binDir, 'npx'), '#!/bin/sh\nexit 0\n');
  writeExecutable(join(binDir, 'mktemp'), '#!/bin/sh\nexit 1\n');
  return binDir;
}

function seedAggregateState(workDir) {
  writeFileSync(
    join(workDir, STATE),
    JSON.stringify({
      aggregate_gate: { executed: true, gate: 'READY', source: null, reason: null, last_run: '' },
    })
  );
}

function runEditHook(workDir, binDir, filePath) {
  return spawnSync('bash', [editHook], {
    cwd: workDir,
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, HOOK_NO_FORMAT: '1' },
  });
}

test('CONTROL: a failed state write really does append its reason to a REAL shared sidecar', () => {
  const workDir = makeTempDir('sd0x-sidecar-write-control-');
  const binDir = setupEditStubBin();
  seedAggregateState(workDir);

  runEditHook(workDir, binDir, '/project/src/app.ts');

  assert.equal(
    existsSync(join(workDir, SHARED_SIDECAR)),
    true,
    'control: with no symlink in the way the reason lands in the shared file'
  );
  assert.match(readFileSync(join(workDir, SHARED_SIDECAR), 'utf8'), /state_write_failed:code/);
});

test('the shared sidecar append is refused through a symlink and DIVERTED to a per-event marker', () => {
  // `>>` follows the link and appends into its target. Refusing is only half the fix — a marker
  // exists precisely because a blocking transition was already lost, so dropping it would be
  // fail-OPEN. The reason has to land somewhere this process owns.
  const workDir = makeTempDir('sd0x-sidecar-write-symlink-');
  const binDir = setupEditStubBin();
  seedAggregateState(workDir);
  const outsider = join(workDir, 'outsider.txt');
  writeFileSync(outsider, 'untouched\n');
  symlinkSync('outsider.txt', join(workDir, SHARED_SIDECAR));

  const result = runEditHook(workDir, binDir, '/project/src/app.ts');

  assert.equal(
    readFileSync(outsider, 'utf8'),
    'untouched\n',
    'the append must not write through the link into an arbitrary file'
  );
  const markers = eventMarkers(workDir);
  assert.equal(markers.length, 1, 'the refused reason must be diverted, not dropped');
  assert.match(
    readFileSync(join(workDir, markers[0]), 'utf8'),
    /state_write_failed:code/,
    'the diverted marker must carry the same reason the append would have recorded'
  );
  assert.match(
    result.stderr,
    /symlink/i,
    'the divert must be reported — a silent one is indistinguishable from a normal write'
  );
});

// ---------------------------------------------------------------------------
// post-tool-review-state: the OTHER copy of the same setter
// ---------------------------------------------------------------------------
//
// Two hooks carry `_set_own_sidecar` / `_set_own_sidecar_locked`, byte-identical apart from the log
// prefix. Testing one proves nothing about the other: a mutation that dropped the refusal from
// post-tool-review-state alone left this file entirely green until this test existed.

const stateHook = resolve(__dirname, '../../hooks/post-tool-review-state.sh');

test('post-tool-review-state refuses the same append through a symlink and diverts it too', () => {
  // WB5b: a lost mirror verdict no longer raises a sidecar (the mirror is advisory), so the
  // surviving `_set_own_sidecar` caller in this hook is the aggregate branch — a recognized
  // `emit-review-gate.sh` invocation whose aggregate write fails on the shadowed mktemp raises
  // `aggregate_write_failed`, and the raise must refuse the symlink exactly like the edit hook's.
  const workDir = makeTempDir('sd0x-sidecar-verdict-symlink-');
  const binDir = makeTempDir('sd0x-sidecar-verdict-bin-');
  // Only mktemp is shadowed — real jq does the parsing.
  writeExecutable(join(binDir, 'mktemp'), '#!/bin/sh\nexit 1\n');
  writeFileSync(
    join(workDir, STATE),
    JSON.stringify({
      aggregate_gate: { executed: false, gate: null, source: null, reason: null, last_run: '' },
    })
  );
  const outsider = join(workDir, 'outsider.txt');
  writeFileSync(outsider, 'untouched\n');
  symlinkSync('outsider.txt', join(workDir, SHARED_SIDECAR));

  const result = spawnSync('bash', [stateHook], {
    cwd: workDir,
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'bash scripts/emit-review-gate.sh READY' },
      tool_output: 'REVIEW_GATE=READY',
    }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0, 'the hook must degrade, not crash');
  assert.equal(
    readFileSync(outsider, 'utf8'),
    'untouched\n',
    'a lost aggregate transition must not be appended through the link into an arbitrary file'
  );
  const markers = eventMarkers(workDir);
  assert.equal(markers.length, 1, 'the refused reason must be diverted, not dropped');
  assert.match(
    readFileSync(join(workDir, markers[0]), 'utf8'),
    /aggregate_write_failed/,
    'the diverted marker must carry the reason the shared file would have taken'
  );
});

// ---------------------------------------------------------------------------
// stop-guard: the reader
// ---------------------------------------------------------------------------

function setupStopGuardStubBin() {
  const binDir = makeTempDir('sd0x-sidecar-symlink-sg-bin-');
  // Real jq is required by stop-guard for state parsing; pass through to whatever is on PATH.
  writeExecutable(join(binDir, 'noop'), '#!/bin/sh\nexit 0\n');
  return binDir;
}

function runStopGuard(workDir, env = {}) {
  const transcriptPath = join(workDir, 'transcript.json');
  if (!existsSync(transcriptPath)) writeFileSync(transcriptPath, '[]');
  return spawnSync('bash', [stopGuardHook], {
    cwd: workDir,
    input: JSON.stringify({ transcript_path: transcriptPath }),
    encoding: 'utf8',
    env: { ...process.env, STOP_GUARD_MODE: 'warn', ...env },
  });
}

function seedPassingState(workDir) {
  writeFileSync(
    join(workDir, STATE),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
    })
  );
}

const SECRET_LINE = 'state_init_failed:code';

test('CONTROL: those same bytes in a REAL sidecar do escalate and are reported', () => {
  const workDir = makeTempDir('sd0x-sidecar-read-control-');
  setupStopGuardStubBin();
  seedPassingState(workDir);
  writeFileSync(join(workDir, SHARED_SIDECAR), `${SECRET_LINE}\n`);

  const result = runStopGuard(workDir);

  assert.notEqual(result.status, 0, 'a non-transient reason must escalate warn to strict and block');
  assert.match(
    result.stderr,
    new RegExp(SECRET_LINE.replace(':', ':')),
    'control: a genuine marker IS classified and reported'
  );
});

test('a symlinked sidecar contributes no reasons — its target is never read into the reason set', () => {
  // Two failures at once if `-f` is used: the link counts as evidence of a verdict that was never
  // lost (a spurious block), and the target's bytes are spliced into `SIDECAR_REASON`, which the
  // hook prints — an arbitrary file disclosed into the hook log.
  const workDir = makeTempDir('sd0x-sidecar-read-symlink-');
  setupStopGuardStubBin();
  seedPassingState(workDir);
  const secretFile = join(workDir, 'secret.txt');
  writeFileSync(secretFile, `${SECRET_LINE}\nSECRET-CANARY-9f3a\n`);
  symlinkSync('secret.txt', join(workDir, SHARED_SIDECAR));

  const result = runStopGuard(workDir);

  assert.equal(
    result.status,
    0,
    'a planted link is not evidence of a lost verdict and must not block an otherwise passing stop'
  );
  assert.doesNotMatch(
    result.stderr,
    /SECRET-CANARY-9f3a/,
    "a linked file's contents must never reach the hook log"
  );
});

test('a symlinked per-event marker contributes no reasons either', () => {
  const workDir = makeTempDir('sd0x-sidecar-read-symlink-event-');
  setupStopGuardStubBin();
  seedPassingState(workDir);
  const secretFile = join(workDir, 'secret.txt');
  writeFileSync(secretFile, `${SECRET_LINE}\nSECRET-CANARY-7b1c\n`);
  symlinkSync('secret.txt', join(workDir, `${EVENT_PREFIX}4242-planted`));

  const result = runStopGuard(workDir);

  assert.equal(result.status, 0, 'the per-event plane must apply the same test as the shared file');
  assert.doesNotMatch(result.stderr, /SECRET-CANARY-7b1c/);
});

// The two tests above only reach `_sidecar_any`, which short-circuits to "no sidecar at all" when
// the only thing present is a link — so stop-guard's own classification loop is never entered and
// its per-source tests are never exercised. That loop is separately reachable, and its bytes go
// straight into `SIDECAR_REASON`, which the hook PRINTS. The mix below reaches it: one plane holds
// a genuine marker (so `_sidecar_any` is true and the loop runs), the other holds a link.
//
// A transient reason is used for the genuine marker on purpose. It keeps the correct outcome at
// exit 0, so following the link flips BOTH observable properties at once — the canary appears in
// the log AND warn silently escalates to a block.

test('a REAL marker alongside a symlinked shared file does not splice the target into the reasons', () => {
  const workDir = makeTempDir('sd0x-sidecar-read-mixed-shared-');
  setupStopGuardStubBin();
  seedPassingState(workDir);
  const secretFile = join(workDir, 'secret.txt');
  writeFileSync(secretFile, `${SECRET_LINE}\nSECRET-CANARY-mixed-a\n`);
  symlinkSync('secret.txt', join(workDir, SHARED_SIDECAR));
  writeFileSync(join(workDir, `${EVENT_PREFIX}5150-real`), 'edit_lock_contention:code\n');

  const result = runStopGuard(workDir);

  assert.equal(
    result.status,
    0,
    'only the genuine TRANSIENT reason may be classified — following the link would escalate to a block'
  );
  assert.doesNotMatch(
    result.stderr,
    /SECRET-CANARY-mixed-a/,
    "the linked file's contents must not reach SIDECAR_REASON, which the hook prints"
  );
  assert.match(result.stderr, /transient/, 'non-vacuity: the classifier really did run in this call');
});

test('a REAL shared marker alongside a symlinked per-event marker splices nothing either', () => {
  const workDir = makeTempDir('sd0x-sidecar-read-mixed-event-');
  setupStopGuardStubBin();
  seedPassingState(workDir);
  const secretFile = join(workDir, 'secret.txt');
  writeFileSync(secretFile, `${SECRET_LINE}\nSECRET-CANARY-mixed-b\n`);
  symlinkSync('secret.txt', join(workDir, `${EVENT_PREFIX}5151-planted`));
  writeFileSync(join(workDir, SHARED_SIDECAR), 'edit_lock_contention:code\n');

  const result = runStopGuard(workDir);

  assert.equal(result.status, 0, 'the per-event branch of the classifier must reject the link too');
  assert.doesNotMatch(result.stderr, /SECRET-CANARY-mixed-b/);
  assert.match(result.stderr, /transient/, 'non-vacuity: the classifier really did run in this call');
});
