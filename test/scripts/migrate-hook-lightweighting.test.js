'use strict';

// migrate-hook-lightweighting.js — § 3.6 obsolete-set cleanup. The order is the
// contract: compute → deregister (both settings files) → delete only after the
// settings writes succeed. The two spec-named cases — a failed settings write and
// a locally modified obsolete file — are pinned here alongside the happy path.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const scriptPath = resolve(__dirname, '../../scripts/migrate-hook-lightweighting.js');

function blobSha1(content) {
  const buf = Buffer.from(content);
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

const cleanups = [];
test.after(() => { for (const dir of cleanups) rmSync(dir, { recursive: true, force: true }); });

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'migrate-hl-'));
  cleanups.push(repo);
  mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true });
  mkdirSync(join(repo, '.claude', 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(repo, '.sd0x'), { recursive: true });
  return repo;
}

const HOOK_ENTRY = (name) => ({
  type: 'command',
  command: `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${name}`,
});

function seedStandardRepo(repo, { modifyObsoleteHook = false } = {}) {
  const obsoleteHook = '#!/bin/bash\nexit 2\n';
  const obsoleteScript = 'module.exports = "dispatch";\n';
  const keptHook = '#!/bin/bash\nexit 0\n';
  writeFileSync(join(repo, '.claude', 'hooks', 'post-tool-review-state.sh'), obsoleteHook);
  writeFileSync(join(repo, '.claude', 'hooks', 'stop-guard.sh'), keptHook);
  writeFileSync(join(repo, '.claude', 'scripts', 'dispatch-cli.js'), obsoleteScript);
  writeFileSync(join(repo, '.claude', 'scripts', 'lib', 'gate-derive.js'), obsoleteScript);
  const manifest = {
    schema_version: 1,
    plugin_version: '4.2.0',
    hook_scripts: {
      'post-tool-review-state.sh': {
        hash: modifyObsoleteHook ? blobSha1('something else entirely\n') : blobSha1(obsoleteHook),
      },
      'stop-guard.sh': { hash: blobSha1(keptHook) },
    },
    scripts: {
      'dispatch-cli.js': { hash: blobSha1(obsoleteScript) },
      'lib/gate-derive.js': { hash: blobSha1(obsoleteScript) },
    },
    rules: {},
  };
  writeFileSync(join(repo, '.sd0x', 'install-state.json'), JSON.stringify(manifest, null, 2));
  const settings = {
    env: { STOP_GUARD_MODE: 'strict', KEEP_ME: '1' },
    hooks_config: { stop_guard_mode: 'strict' },
    hooks: {
      PostToolUse: [
        { matcher: 'Bash', hooks: [HOOK_ENTRY('post-tool-review-state.sh')] },
        { matcher: 'Edit|Write', hooks: [HOOK_ENTRY('post-edit-format.sh')] },
      ],
      Stop: [{ matcher: '', hooks: [HOOK_ENTRY('stop-guard.sh')] }],
    },
  };
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  writeFileSync(join(repo, '.claude_review_state.json'), '{"stale":true}\n');
  writeFileSync(join(repo, '.claude_review_state.json.blocked'), 'x\n');
  writeFileSync(join(repo, '.claude_nit_history.json'), '{}\n');
}

function run(repo, extra = []) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--repo', repo, ...extra], { encoding: 'utf8' });
    return { exitCode: 0, stdout };
  } catch (err) {
    return { exitCode: err.status, stdout: (err.stdout || '') + (err.stderr || '') };
  }
}

const readSettings = (repo, name = 'settings.json') =>
  JSON.parse(readFileSync(join(repo, '.claude', name), 'utf8'));

test('happy path → obsolete files deleted, entries deregistered, kept surfaces untouched', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  const { exitCode, stdout } = run(repo);
  assert.equal(exitCode, 0, stdout);

  assert.ok(!existsSync(join(repo, '.claude', 'hooks', 'post-tool-review-state.sh')), 'obsolete hook deleted');
  assert.ok(!existsSync(join(repo, '.claude', 'scripts', 'dispatch-cli.js')), 'obsolete script deleted');
  assert.ok(!existsSync(join(repo, '.claude', 'scripts', 'lib', 'gate-derive.js')), 'obsolete lib deleted');
  assert.ok(existsSync(join(repo, '.claude', 'hooks', 'stop-guard.sh')), 'kept hook survives');

  const settings = readSettings(repo);
  const serialized = JSON.stringify(settings);
  assert.ok(!serialized.includes('post-tool-review-state.sh'), 'obsolete entry deregistered');
  assert.ok(serialized.includes('stop-guard.sh'), 'kept entry survives');
  assert.ok(!('STOP_GUARD_MODE' in (settings.env || {})), 'STOP_GUARD_MODE removed');
  assert.equal(settings.env.KEEP_ME, '1', 'unrelated env keys survive');
  assert.ok(!settings.hooks_config, 'legacy hooks_config.stop_guard_mode removed (empty object dropped)');

  const manifest = JSON.parse(readFileSync(join(repo, '.sd0x', 'install-state.json'), 'utf8'));
  assert.deepEqual(manifest.hook_scripts['post-tool-review-state.sh'], { deleted: true }, 'deleted entry tombstoned');
  assert.ok(manifest.hook_scripts['stop-guard.sh'].hash, 'kept entry retains its hash');

  assert.ok(!existsSync(join(repo, '.claude_review_state.json')), 'mirror state file deleted');
  assert.ok(!existsSync(join(repo, '.claude_review_state.json.blocked')), 'state sibling deleted');
  assert.ok(!existsSync(join(repo, '.claude_nit_history.json')), 'nit history deleted');
  assert.match(stdout, /STOP_GUARD_MODE/, 'the posture change is named loudly in the report');
});

test('modified obsolete file → kept on disk, deregistered, reported', () => {
  const repo = makeRepo();
  seedStandardRepo(repo, { modifyObsoleteHook: true });
  const { exitCode, stdout } = run(repo);
  assert.equal(exitCode, 0, stdout);
  assert.ok(existsSync(join(repo, '.claude', 'hooks', 'post-tool-review-state.sh')),
    'a hash-mismatched file is never deleted');
  assert.ok(!JSON.stringify(readSettings(repo)).includes('post-tool-review-state.sh'),
    'its registration is still removed — the user-edited enforcement hook must stop running');
  assert.match(stdout, /modified locally.*kept on disk/, 'the preserve-and-report line is in the report');
});

test('settings write failure → aborts before any deletion', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  chmodSync(join(repo, '.claude', 'settings.json'), 0o444);
  const { exitCode, stdout } = run(repo);
  chmodSync(join(repo, '.claude', 'settings.json'), 0o644);
  assert.equal(exitCode, 1, 'a failed settings write is an abort, not a warning');
  assert.ok(existsSync(join(repo, '.claude', 'hooks', 'post-tool-review-state.sh')),
    'no file deletion after a failed deregistration');
  assert.ok(existsSync(join(repo, '.claude_review_state.json')),
    'state files also survive an aborted run');
  assert.match(stdout, /aborting before deletion/);
});

test('unparseable settings.json → aborts before any deletion', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  writeFileSync(join(repo, '.claude', 'settings.json'), '{ not json');
  const { exitCode } = run(repo);
  assert.equal(exitCode, 1, 'unverifiable deregistration is an abort');
  assert.ok(existsSync(join(repo, '.claude', 'scripts', 'dispatch-cli.js')),
    'no deletion when the settings file cannot be parsed');
});

test('no manifest → settings deregistered, files reported but never deleted', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  rmSync(join(repo, '.sd0x', 'install-state.json'));
  const { exitCode, stdout } = run(repo);
  assert.equal(exitCode, 0, stdout);
  assert.ok(!JSON.stringify(readSettings(repo)).includes('post-tool-review-state.sh'),
    'deregistration works off the known filename list without a manifest');
  assert.ok(existsSync(join(repo, '.claude', 'hooks', 'post-tool-review-state.sh')),
    'without a manifest hash nothing is deleted');
  assert.match(stdout, /left in place/);
});

test('inline bash -c entry referencing an obsolete script → removed by substring match', () => {
  // The old hooks.json shipped a SessionStart entry as `bash -c '… dispatch-cli.js …'`
  // — no basename to match, but the obsolete name is in the command body. Found live
  // during the WB6 self-install; pinned so the substring predicate never regresses to
  // basename-only.
  const repo = makeRepo();
  seedStandardRepo(repo);
  const settings = readSettings(repo);
  settings.hooks.SessionStart = [{
    matcher: 'resume',
    hooks: [{ type: 'command', command: 'bash -c \'CLI="$PWD/.claude/scripts/dispatch-cli.js"; node "$CLI" compact\'' }],
  }];
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  const { exitCode, stdout } = run(repo);
  assert.equal(exitCode, 0, stdout);
  const after = readSettings(repo);
  assert.ok(!JSON.stringify(after).includes('dispatch-cli'), 'the inline entry must be deregistered');
  assert.ok(!('SessionStart' in (after.hooks || {})), 'an emptied event array is dropped');
});

test('unrelated dangling entry → reported, never removed', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  const settings = readSettings(repo);
  settings.hooks.PostToolUse.push({ matcher: 'Bash', hooks: [HOOK_ENTRY('my-own-hook.sh')] });
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  const { exitCode, stdout } = run(repo);
  assert.equal(exitCode, 0, stdout);
  assert.ok(JSON.stringify(readSettings(repo)).includes('my-own-hook.sh'),
    'the removal predicate is the known filename list, not "dangling"');
  assert.match(stdout, /dangling.*my-own-hook\.sh/, 'the dangling entry is surfaced to the user');
});

test('settings.local.json is scrubbed too', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  writeFileSync(join(repo, '.claude', 'settings.local.json'), JSON.stringify({
    env: { STOP_GUARD_MODE: 'warn' },
    hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [HOOK_ENTRY('post-tool-review-state.sh')] }] },
  }, null, 2));
  const { exitCode } = run(repo);
  assert.equal(exitCode, 0);
  const local = readSettings(repo, 'settings.local.json');
  assert.ok(!JSON.stringify(local).includes('post-tool-review-state.sh'), 'local entry deregistered');
  assert.ok(!('STOP_GUARD_MODE' in (local.env || {})), 'local STOP_GUARD_MODE removed');
});

test('both manifests present → canonical wins, legacy reported stale', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  writeFileSync(join(repo, '.claude', '.sd0x-install-state.json'), JSON.stringify({
    schema_version: 1, hook_scripts: {}, scripts: {}, rules: {},
  }, null, 2));
  const { exitCode, stdout } = run(repo);
  assert.equal(exitCode, 0, stdout);
  assert.match(stdout, /legacy manifest .* stale/, 'legacy staleness is reported');
  assert.ok(!existsSync(join(repo, '.claude', 'scripts', 'dispatch-cli.js')),
    'deletion ran off the canonical manifest, not the empty legacy one');
});

test('dry run → full report, zero mutation', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  const before = readFileSync(join(repo, '.claude', 'settings.json'), 'utf8');
  const { exitCode, stdout } = run(repo, ['--dry-run']);
  assert.equal(exitCode, 0, stdout);
  assert.match(stdout, /dry run/);
  assert.equal(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'), before, 'settings untouched');
  assert.ok(existsSync(join(repo, '.claude', 'hooks', 'post-tool-review-state.sh')), 'files untouched');
  assert.ok(existsSync(join(repo, '.claude_review_state.json')), 'state files untouched');
});

test('clean repo → exits 0 with nothing to migrate', () => {
  const repo = makeRepo();
  const { exitCode, stdout } = run(repo);
  assert.equal(exitCode, 0, stdout);
  assert.match(stdout, /nothing to migrate|abandoned in place/);
});

test('state cleanup deletes only exact hook-generated names — user siblings preserved and reported', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  writeFileSync(join(repo, '.claude_review_state.json.backup'), 'user backup\n');
  writeFileSync(join(repo, '.claude_nit_history.json.old'), 'user copy\n');
  mkdirSync(join(repo, '.claude_review_state.json.lockdir'), { recursive: true });
  // Names the review-state stem generated but the nit-history stem never did —
  // a cross-product allowlist would wrongly delete these two:
  writeFileSync(join(repo, '.claude_nit_history.json.blocked'), 'user file\n');
  mkdirSync(join(repo, '.claude_nit_history.json.blocked.lockdir'), { recursive: true });
  const { exitCode, stdout } = run(repo);
  assert.equal(exitCode, 0, stdout);
  // Hook-generated artifacts go:
  assert.equal(existsSync(join(repo, '.claude_review_state.json')), false);
  assert.equal(existsSync(join(repo, '.claude_review_state.json.blocked')), false);
  assert.equal(existsSync(join(repo, '.claude_review_state.json.lockdir')), false);
  assert.equal(existsSync(join(repo, '.claude_nit_history.json')), false);
  // User-created siblings sharing the stem prefix stay, and the report says so:
  assert.equal(readFileSync(join(repo, '.claude_review_state.json.backup'), 'utf8'), 'user backup\n');
  assert.equal(readFileSync(join(repo, '.claude_nit_history.json.old'), 'utf8'), 'user copy\n');
  assert.equal(readFileSync(join(repo, '.claude_nit_history.json.blocked'), 'utf8'), 'user file\n');
  assert.equal(existsSync(join(repo, '.claude_nit_history.json.blocked.lockdir')), true);
  assert.match(stdout, /\.claude_review_state\.json\.backup left in place/);
  assert.match(stdout, /\.claude_nit_history\.json\.old left in place/);
  assert.match(stdout, /\.claude_nit_history\.json\.blocked left in place/);
  assert.match(stdout, /\.claude_nit_history\.json\.blocked\.lockdir left in place/);
});

test('deregistration matches token boundaries — wrapper-named entry survives, inline dispatch-cli entry removed', () => {
  const repo = makeRepo();
  seedStandardRepo(repo);
  const settings = readSettings(repo);
  settings.hooks.PostToolUse.push({
    matcher: 'Task',
    hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/post-tool-review-state.sh-wrapper' }],
  });
  settings.hooks.SessionStart = [
    { matcher: '', hooks: [{ type: 'command', command: 'bash -c \'node "$CLAUDE_PROJECT_DIR"/.claude/scripts/dispatch-cli.js compact || true\'' }] },
  ];
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  const { exitCode, stdout } = run(repo);
  assert.equal(exitCode, 0, stdout);
  const after = JSON.stringify(readSettings(repo));
  assert.ok(after.includes('post-tool-review-state.sh-wrapper'), 'wrapper-named entry is not the obsolete script and must survive');
  assert.ok(!after.includes('dispatch-cli.js'), 'inline bash -c dispatch-cli.js entry must still be deregistered');
  assert.ok(!after.includes('"post-tool-review-state.sh"'), 'the real obsolete entry is gone');
});
