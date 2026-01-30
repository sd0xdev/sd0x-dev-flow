#!/usr/bin/env node
/**
 * intake_cached.js (方案 A)
 * - cache per repo + commit
 * - mode:
 *   - auto: delta-first; run full only when needed; use cache if hit
 *   - full: force full
 *   - delta: force delta
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SCANNER_VERSION = 'repo-intake-midway@1.0.0';

function run(cmd, args, cwd = process.cwd()) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}
function writeText(p, s) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, s, 'utf8');
}
function writeJson(p, obj) {
  writeText(p, JSON.stringify(obj, null, 2));
}
function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function safeSlug(s) {
  return (s || '')
    .replace(/\s+/g, '-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function getRepoRoot() {
  const r = run('git', ['rev-parse', '--show-toplevel']);
  return r.ok && r.stdout ? r.stdout : null;
}
function getHead() {
  const r = run('git', ['rev-parse', 'HEAD']);
  return r.ok && r.stdout ? r.stdout : null;
}
function getBranch() {
  const r = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok && r.stdout ? r.stdout : null;
}
function getRemoteUrl() {
  const r = run('git', ['config', '--get', 'remote.origin.url']);
  return r.ok && r.stdout ? r.stdout : null;
}

function repoKey(repoRoot) {
  const base = path.basename(repoRoot);
  const remote = getRemoteUrl() || repoRoot;
  const h = sha1(remote).slice(0, 8);
  return `${safeSlug(base)}--${h}`;
}

function parseArgs(argv) {
  const args = {
    mode: 'auto',
    top: 12,
    base: 'HEAD~1',
    keep: 30,
    format: 'md',
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--mode' && v) args.mode = v;
    if (k === '--top' && v) args.top = parseInt(v, 10) || 12;
    if (k === '--base' && v) args.base = v;
    if (k === '--keep' && v) args.keep = parseInt(v, 10) || 30;
    if (k === '--format' && v) args.format = v;
  }
  return args;
}

function listCommitDirs(commitsDir) {
  try {
    return fs
      .readdirSync(commitsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(commitsDir, d.name));
  } catch {
    return [];
  }
}
function mtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
function prune(commitsDir, keep) {
  const dirs = listCommitDirs(commitsDir)
    .map(d => ({ d, t: mtimeMs(d) }))
    .sort((a, b) => b.t - a.t);
  for (const x of dirs.slice(keep)) {
    try {
      fs.rmSync(x.d, { recursive: true, force: true });
    } catch {}
  }
}

function runNodeScript(scriptPath, args, cwd) {
  return run('node', [scriptPath, ...args], cwd);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    process.stderr.write('Error: not inside a git repo\n');
    process.exit(2);
  }

  let head = getHead();
  let branch = getBranch();
  const hasHead = !!head;
  if (!head) head = 'UNBORN';
  const key = repoKey(repoRoot);

  const cacheBase =
    process.env.CLAUDE_REPO_INTAKE_CACHE_DIR ||
    path.join(os.homedir(), '.claude', 'cache', 'repo-intake-midway');

  const repoCacheDir = path.join(cacheBase, key);
  const commitsDir = path.join(repoCacheDir, 'commits');
  const commitDir = path.join(commitsDir, head);

  ensureDir(commitDir);

  const fullMd = path.join(commitDir, `full.top${args.top}.md`);
  const fullJson = path.join(commitDir, `full.top${args.top}.json`);
  const deltaMd = path.join(commitDir, `delta.base-${safeSlug(args.base)}.md`);
  const deltaJson = path.join(
    commitDir,
    `delta.base-${safeSlug(args.base)}.json`
  );
  const metaPath = path.join(commitDir, `meta.json`);

  const latestMd = path.join(repoCacheDir, 'latest.md');
  const latestJson = path.join(repoCacheDir, 'latest.json');
  const latestInfo = path.join(repoCacheDir, 'LATEST.json');

  const meta = (() => {
    try {
      return JSON.parse(readText(metaPath) || 'null');
    } catch {
      return null;
    }
  })();

  const fullCacheHit =
    fs.existsSync(fullMd) &&
    fs.existsSync(fullJson) &&
    meta &&
    meta.scannerVersion === SCANNER_VERSION &&
    meta.top === args.top;

  function writeMeta(extra = {}) {
    writeJson(metaPath, {
      scannerVersion: SCANNER_VERSION,
      generatedAt: new Date().toISOString(),
      repoRoot,
      repoKey: key,
      head,
      branch,
      top: args.top,
      base: args.base,
      ...extra,
    });
  }

  function updateLatest(payload) {
    if (payload.mdPath && fs.existsSync(payload.mdPath))
      writeText(latestMd, readText(payload.mdPath));
    if (payload.jsonPath && fs.existsSync(payload.jsonPath))
      writeText(latestJson, readText(payload.jsonPath));
    writeJson(latestInfo, payload);
  }

  const fullScanner = path.join(__dirname, 'scan_midway_repo.js');
  const deltaScanner = path.join(__dirname, 'scan_midway_delta.js');

  if (!branch || branch === 'HEAD') branch = 'unknown';

  function runFullScan(metaExtra, latestMode, latestExtra = {}) {
    const rMd = runNodeScript(
      fullScanner,
      ['--format', 'md', '--top', String(args.top)],
      repoRoot
    );
    writeText(
      fullMd,
      rMd.ok ? rMd.stdout : `# full scan failed\n\n${rMd.stderr}`
    );

    const rJson = runNodeScript(
      fullScanner,
      ['--format', 'json', '--top', String(args.top)],
      repoRoot
    );
    writeText(
      fullJson,
      rJson.ok ? rJson.stdout : JSON.stringify({ error: rJson.stderr }, null, 2)
    );

    writeMeta(metaExtra);
    updateLatest({
      updatedAt: new Date().toISOString(),
      repoRoot,
      repoKey: key,
      head,
      branch,
      mode: latestMode,
      mdPath: fullMd,
      jsonPath: fullJson,
      ...latestExtra,
    });

    prune(commitsDir, args.keep);
    process.stdout.write(
      args.format === 'json' ? readText(fullJson) : readText(fullMd)
    );
  }

  if (!hasHead) {
    head = 'UNBORN';
    runFullScan(
      { mode: args.mode, decided: 'full', reason: 'no-head' },
      'full-no-head',
      { reason: 'no-head' }
    );
    return;
  }

  // force full
  if (args.mode === 'full') {
    runFullScan({ mode: 'full' }, 'full');
    return;
  }

  // auto cache hit
  if (args.mode === 'auto' && fullCacheHit) {
    updateLatest({
      updatedAt: new Date().toISOString(),
      repoRoot,
      repoKey: key,
      head,
      branch,
      mode: 'full-cache-hit',
      mdPath: fullMd,
      jsonPath: fullJson,
    });
    process.stdout.write(
      args.format === 'json' ? readText(fullJson) : readText(fullMd)
    );
    return;
  }

  // run delta first
  const dJson = runNodeScript(
    deltaScanner,
    ['--format', 'json', '--base', args.base],
    repoRoot
  );
  if (!dJson.ok) {
    // delta fail => fallback full
    runFullScan(
      { mode: 'auto', deltaError: dJson.stderr || 'delta failed' },
      'auto-fallback-full',
      { reason: 'delta failed' }
    );
    return;
  }

  writeText(deltaJson, dJson.stdout);

  let dObj = null;
  try {
    dObj = JSON.parse(dJson.stdout);
  } catch {
    dObj = { shouldRunFull: true, reasons: ['delta-json-parse-failed'] };
  }

  const dMd = runNodeScript(
    deltaScanner,
    ['--format', 'md', '--base', args.base],
    repoRoot
  );
  writeText(
    deltaMd,
    dMd.ok ? dMd.stdout : `# delta scan failed\n\n${dMd.stderr}`
  );

  if (args.mode === 'delta') {
    writeMeta({ mode: 'delta' });
    updateLatest({
      updatedAt: new Date().toISOString(),
      repoRoot,
      repoKey: key,
      head,
      branch,
      mode: 'delta',
      mdPath: deltaMd,
      jsonPath: deltaJson,
    });
    prune(commitsDir, args.keep);
    process.stdout.write(
      args.format === 'json' ? readText(deltaJson) : readText(deltaMd)
    );
    return;
  }

  const shouldRunFull = !!dObj.shouldRunFull;

  if (shouldRunFull) {
    runFullScan(
      {
        mode: 'auto',
        decided: 'full',
        delta: { base: args.base, reasons: dObj.reasons || [] },
      },
      'auto-full',
      { decidedFromDelta: true }
    );
    return;
  }

  // auto decided delta
  writeMeta({
    mode: 'auto',
    decided: 'delta',
    delta: { base: args.base, reasons: dObj.reasons || [] },
  });
  updateLatest({
    updatedAt: new Date().toISOString(),
    repoRoot,
    repoKey: key,
    head,
    branch,
    mode: 'auto-delta',
    mdPath: deltaMd,
    jsonPath: deltaJson,
    decidedFromDelta: true,
  });

  prune(commitsDir, args.keep);
  process.stdout.write(
    args.format === 'json' ? readText(deltaJson) : readText(deltaMd)
  );
}

main();
