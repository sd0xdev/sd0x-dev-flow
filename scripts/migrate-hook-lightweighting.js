#!/usr/bin/env node
'use strict';
// migrate-hook-lightweighting.js — one-shot obsolete-set cleanup for consuming repos
// (hook-lightweighting § 3.6). Invoked by /install-hooks and /install-scripts so
// neither entry point can reproduce the unsafe order by hand.
//
// Order is the contract, not an implementation detail:
//   1. Compute, mutate nothing.
//   2. Deregister first (settings.json AND settings.local.json) — including entries
//      for modified files step 3 will preserve, so a user-edited copy of the old
//      enforcement hook stops running rather than surviving registration forever.
//   3. Delete only after the settings writes succeed. A failed settings write aborts
//      before any deletion — the half-state this exists to prevent is scripts-new +
//      hooks-old (the old post-tool-review-state.sh blocking dispatches with exit 2
//      once dispatch-cli.js is gone).
//
// No signature corpus, no ownership inventory: the removal predicate is the known
// obsolete sd0x filename list below, never "dangling". An unrelated dangling entry
// (a user's own hook whose script is momentarily absent) is reported, never removed.
//
// Usage: node scripts/migrate-hook-lightweighting.js [--repo <root>] [--dry-run] [--json]

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The § 2 deletion set, by manifest category. Keys are manifest entry names
// (hook_scripts entries land in .claude/hooks/, scripts entries in .claude/scripts/).
const OBSOLETE = {
  hook_scripts: ['post-tool-review-state.sh', 'session-init.sh'],
  scripts: [
    'dispatch-cli.js',
    'emit-review-gate.sh',
    'emit-plan-gate.sh',
    'lib/dispatch-log.js',
    'lib/gate-derive.js',
    'lib/receipt-log.js',
    'lib/session-scope-resolver.js',
  ],
  rules: [],
};

const CATEGORY_DIR = {
  hook_scripts: path.join('.claude', 'hooks'),
  scripts: path.join('.claude', 'scripts'),
  rules: path.join('.claude', 'rules'),
};

// Repo-root state files the deleted hooks generated (§ 3.3) — an exact per-stem
// deletion list; ambiguous suffixes (`.tmp`-style temps, `.blocked.event.*`) are
// left to the conservative reporting path in deleteObsoleteFiles.
// Per stem, EXACTLY the durable names the deleted hooks created (verified against
// their HEAD implementations): review state also had `.blocked` sidecars; nit
// history only ever had the bare file and its lockdir.
const OBSOLETE_STATE_NAMES = {
  '.claude_review_state.json': ['', '.lockdir', '.blocked', '.blocked.lockdir'],
  '.claude_nit_history.json': ['', '.lockdir'],
};

// git hash-object without git: sha1 over the blob header + content.
function blobSha1(buf) {
  return crypto
    .createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex');
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), dryRun: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--repo') {
      i += 1;
      if (i >= argv.length) throw new Error('--repo requires a value');
      args.repo = path.resolve(argv[i]);
    } else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--json') args.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function readJson(p) {
  // Distinguish "absent" (fine, skip) from "present but unreadable/unparseable"
  // (fail-closed: we cannot prove deregistration happened, so deletion must not run).
  if (!fs.existsSync(p)) return { state: 'absent' };
  try {
    return { state: 'ok', value: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    return { state: 'unreadable', error: e.message };
  }
}

function loadManifest(repo, report) {
  const canonical = path.join(repo, '.sd0x', 'install-state.json');
  const legacy = path.join(repo, '.claude', '.sd0x-install-state.json');
  const c = readJson(canonical);
  const l = readJson(legacy);
  if (c.state === 'ok') {
    if (l.state !== 'absent') {
      report.push(`ℹ️ legacy manifest ${path.relative(repo, legacy)} is stale — canonical .sd0x/install-state.json wins`);
    }
    return { manifest: c.value, manifestPath: canonical };
  }
  if (c.state === 'unreadable') {
    report.push(`⚠️ canonical manifest unreadable (${c.error}) — treating as no manifest`);
  }
  if (l.state === 'ok') return { manifest: l.value, manifestPath: legacy };
  if (l.state === 'unreadable') {
    report.push(`⚠️ legacy manifest unreadable (${l.error}) — treating as no manifest`);
  }
  return { manifest: null, manifestPath: null };
}

// ---- Step 1: compute, mutate nothing --------------------------------------------

function computeCandidates(repo, manifest, report) {
  const candidates = [];
  for (const [category, names] of Object.entries(OBSOLETE)) {
    for (const name of names) {
      const rel = path.join(CATEGORY_DIR[category], name);
      const abs = path.join(repo, rel);
      const entry = manifest && manifest[category] && manifest[category][name];
      const manifestHash = entry && typeof entry === 'object' ? entry.hash : undefined;
      const inManifest = Boolean(entry);
      const onDisk = fs.existsSync(abs);
      if (!inManifest && !onDisk) continue;
      candidates.push({ category, name, rel, abs, inManifest, manifestHash: manifestHash || null, onDisk });
    }
  }
  if (!manifest) {
    report.push('ℹ️ no install manifest found — settings deregistration proceeds on the known obsolete filename list; files are reported, never deleted');
  }
  return candidates;
}

function obsoleteBasenames() {
  const names = new Set();
  for (const list of Object.values(OBSOLETE)) {
    for (const name of list) names.add(path.posix.basename(name));
  }
  return names;
}

// ---- Step 2: deregister first ---------------------------------------------------

function scrubSettingsObject(settings, repo, report, fileLabel) {
  const obsolete = obsoleteBasenames();
  let changed = false;
  if (settings.hooks && typeof settings.hooks === 'object') {
    for (const [event, matchers] of Object.entries(settings.hooks)) {
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        if (!matcher || !Array.isArray(matcher.hooks)) continue;
        const kept = [];
        for (const h of matcher.hooks) {
          const cmd = h && typeof h.command === 'string' ? h.command : '';
          // Match over the WHOLE command, not just its basename: the old hooks.json
          // shipped an inline `bash -c '… dispatch-cli.js …'` SessionStart entry whose
          // basename is shell noise — a basename-only predicate leaves it registered and
          // probing for a script this migration just deleted. But only at token
          // boundaries: a bare substring test would also deregister a user's
          // `post-tool-review-state.sh-wrapper`, which is not the obsolete script.
          const hit = [...obsolete].find((name) => {
            const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|[\\s"'\`/=])${esc}($|[\\s"'\`;)&|])`).test(cmd);
          });
          if (hit) {
            report.push(`🗑️ ${fileLabel}: removed ${event} hook entry → ${hit} (obsolete set)`);
            changed = true;
            continue;
          }
          // Report-only: a registered script that is absent on disk but NOT in the
          // obsolete set is the user's own business.
          const m = cmd.match(/\.claude\/hooks\/([^"'\s]+)/);
          if (m && !fs.existsSync(path.join(repo, '.claude', 'hooks', path.posix.basename(m[1])))) {
            report.push(`⚠️ ${fileLabel}: dangling ${event} entry → ${path.posix.basename(m[1])} (not in the obsolete set — left registered, resolve manually)`);
          }
          kept.push(h);
        }
        if (kept.length !== matcher.hooks.length) matcher.hooks = kept;
      }
      const keptMatchers = matchers.filter((m) => !m || !Array.isArray(m.hooks) || m.hooks.length > 0);
      if (keptMatchers.length !== matchers.length) {
        settings.hooks[event] = keptMatchers;
        changed = true;
      }
      if (settings.hooks[event].length === 0) {
        delete settings.hooks[event];
        changed = true;
      }
    }
  }
  if (settings.env && typeof settings.env === 'object' && 'STOP_GUARD_MODE' in settings.env) {
    delete settings.env.STOP_GUARD_MODE;
    report.push(`🗑️ ${fileLabel}: removed env.STOP_GUARD_MODE — the Stop hook is reminder-only now; strict-mode blocking no longer exists`);
    changed = true;
  }
  if (settings.hooks_config && typeof settings.hooks_config === 'object' && 'stop_guard_mode' in settings.hooks_config) {
    delete settings.hooks_config.stop_guard_mode;
    if (Object.keys(settings.hooks_config).length === 0) delete settings.hooks_config;
    report.push(`🗑️ ${fileLabel}: removed legacy hooks_config.stop_guard_mode`);
    changed = true;
  }
  return changed;
}

function deregister(repo, report, dryRun) {
  for (const name of ['settings.json', 'settings.local.json']) {
    const p = path.join(repo, '.claude', name);
    const r = readJson(p);
    if (r.state === 'absent') continue;
    if (r.state === 'unreadable') {
      report.push(`⛔ ${name} exists but cannot be parsed (${r.error}) — aborting before deletion; deregistration is unverifiable`);
      return false;
    }
    const changed = scrubSettingsObject(r.value, repo, report, name);
    if (!changed || dryRun) continue;
    try {
      fs.writeFileSync(p, `${JSON.stringify(r.value, null, 2)}\n`);
    } catch (e) {
      report.push(`⛔ failed to write ${name} (${e.message}) — aborting before deletion (a still-registered obsolete hook must not outlive its dependencies)`);
      return false;
    }
  }
  return true;
}

// ---- Step 3: delete only after the settings writes succeed ----------------------

function deleteObsoleteFiles(repo, candidates, manifest, manifestPath, report, dryRun) {
  let manifestChanged = false;
  for (const c of candidates) {
    const tombstone = () => {
      if (manifest && manifest[c.category] && manifest[c.category][c.name]) {
        manifest[c.category][c.name] = { deleted: true };
        manifestChanged = true;
      }
    };
    if (!c.onDisk) {
      report.push(`ℹ️ ${c.rel} already absent — manifest entry tombstoned`);
      tombstone();
      continue;
    }
    if (!c.inManifest || !c.manifestHash) {
      report.push(`⚠️ ${c.rel} found on disk with no manifest hash — left in place (delete manually if it is the plugin's copy)`);
      continue;
    }
    const actual = blobSha1(fs.readFileSync(c.abs));
    if (actual === c.manifestHash) {
      if (!dryRun) fs.unlinkSync(c.abs);
      report.push(`🗑️ deleted ${c.rel} (hash matches manifest record)`);
      tombstone();
    } else {
      report.push(`⚠️ ${c.rel} was modified locally — kept on disk; its registration was disabled in step 2`);
      tombstone();
    }
  }
  // Repo-root state artifacts the deleted hooks generated — machine-written, safe to
  // drop, but only under the EXACT per-stem names in OBSOLETE_STATE_NAMES. Anything
  // else sharing a stem prefix is deliberately left alone: crash-orphaned hook
  // artifacts (mktemp `.XXXXXX` temps, `.blocked.event.*` markers) and user files
  // like `.backup` are indistinguishable by pattern — deletion here is conservative
  // by design, so unrecognized siblings are reported, never deleted.
  const generated = new Set();
  for (const [stem, suffixes] of Object.entries(OBSOLETE_STATE_NAMES)) {
    for (const suffix of suffixes) generated.add(`${stem}${suffix}`);
  }
  for (const entry of fs.readdirSync(repo)) {
    if (generated.has(entry)) {
      const abs = path.join(repo, entry);
      if (!dryRun) fs.rmSync(abs, { recursive: true, force: true });
      report.push(`🗑️ deleted state file ${entry} (hook-generated; reminder state now lives under ~/.cache/sd0x-dev-flow/)`);
    } else if (Object.keys(OBSOLETE_STATE_NAMES).some((stem) => entry.startsWith(`${stem}.`))) {
      report.push(`ℹ️ ${entry} left in place — shares a legacy state-file prefix but is not on the exact deletion list (ownership is ambiguous, so deletion stays conservative; remove manually if you know it is a hook leftover)`);
    }
  }
  if (manifestChanged && !dryRun && manifestPath) {
    try {
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      report.push(`✏️ manifest updated: ${path.relative(repo, manifestPath)}`);
    } catch (e) {
      report.push(`⚠️ manifest write failed (${e.message}) — files were already handled; re-run to retry the manifest update`);
    }
  }
  report.push('ℹ️ ~/.cache/sd0x-dev-flow/receipts/ (old receipt ledger) is abandoned in place — remove manually if present');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`[migrate] ${e.message}\n`);
    process.exit(1);
  }
  const report = [];
  const { manifest, manifestPath } = loadManifest(args.repo, report);
  const candidates = computeCandidates(args.repo, manifest, report);

  const settingsOk = deregister(args.repo, report, args.dryRun);
  let aborted = false;
  if (settingsOk) {
    if (manifest) {
      deleteObsoleteFiles(args.repo, candidates, manifest, manifestPath, report, args.dryRun);
    } else {
      for (const c of candidates.filter((x) => x.onDisk)) {
        report.push(`⚠️ ${c.rel} found on disk (no manifest to verify against) — left in place`);
      }
      report.push('ℹ️ ~/.cache/sd0x-dev-flow/receipts/ (old receipt ledger) is abandoned in place — remove manually if present');
    }
  } else {
    aborted = true;
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: !aborted, dryRun: args.dryRun, report }, null, 2)}\n`);
  } else {
    process.stdout.write('## Hook-Lightweighting Migration Report\n\n');
    if (args.dryRun) process.stdout.write('_(dry run — nothing was written)_\n\n');
    for (const line of report) process.stdout.write(`- ${line}\n`);
    if (report.length === 0) process.stdout.write('- ✅ nothing to migrate\n');
  }
  process.exit(aborted ? 1 : 0);
}

main();
