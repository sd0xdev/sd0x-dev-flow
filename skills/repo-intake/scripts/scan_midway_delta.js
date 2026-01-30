#!/usr/bin/env node
/**
 * scan_midway_delta.js
 * Delta scanner: compare --base (default HEAD~1) to HEAD
 *
 * Output JSON includes:
 * - shouldRunFull: boolean
 * - reasons: string[]
 * - changedFiles: { added/modified/deleted/renamed: [...] }
 */

const { spawnSync } = require('child_process');

function run(cmd, args, cwd = process.cwd()) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

function parseArgs(argv) {
  const out = { format: 'md', base: 'HEAD~1' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--format' && v) out.format = v;
    if (k === '--base' && v) out.base = v;
  }
  return out;
}

function classifyNameStatus(lines) {
  const res = { added: [], modified: [], deleted: [], renamed: [] };

  for (const line of lines) {
    if (!line) continue;
    // A\tpath
    // M\tpath
    // D\tpath
    // R100\told\tnew
    const parts = line
      .split('\t')
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length < 2) continue;

    const code = parts[0];
    if (code.startsWith('R')) {
      res.renamed.push({ from: parts[1], to: parts[2] || '' });
      continue;
    }
    const p = parts[1];
    if (code === 'A') res.added.push(p);
    else if (code === 'M') res.modified.push(p);
    else if (code === 'D') res.deleted.push(p);
    else res.modified.push(p);
  }

  return res;
}

function isTopologyFile(p) {
  const low = (p || '').toLowerCase();

  const TOP = [
    'src/configuration.ts',
    'src/configuration.js',
    'bootstrap.js',
    'bootstrap.ts',
    'midway.config.ts',
    'midway.config.js',
    'package.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.build.json',
  ];

  if (TOP.includes(low)) return true;
  if (/(^|\/)test\/unit\//.test(low)) return true;
  if (/(^|\/)test\/integration\//.test(low)) return true;
  if (/(^|\/)test\/e2e\//.test(low)) return true;

  return false;
}

function pickHighlights(files, limit = 20) {
  const uniq = Array.from(new Set(files)).sort();
  return uniq.slice(0, limit);
}

function renderMd(obj) {
  const lines = [];
  lines.push(`# Repo Intake Delta（base: ${obj.base} → HEAD）`);
  lines.push(`- shouldRunFull: **${obj.shouldRunFull ? 'YES' : 'no'}**`);
  if (obj.reasons.length) {
    lines.push(`- reasons: ${obj.reasons.map(r => `\`${r}\``).join(', ')}`);
  }
  lines.push('');

  const cf = obj.changedFiles;

  const section = (title, arr) => {
    lines.push(`## ${title}（${arr.length}）`);
    if (!arr.length) lines.push('- （無）');
    else for (const f of pickHighlights(arr, 30)) lines.push(`- \`${f}\``);
    lines.push('');
  };

  section('Added', cf.added);
  section('Modified', cf.modified);
  section('Deleted', cf.deleted);

  lines.push('## Renamed');
  if (!cf.renamed.length) lines.push('- （無）');
  else
    for (const r of cf.renamed.slice(0, 30))
      lines.push(`- \`${r.from}\` → \`${r.to}\``);
  lines.push('');

  lines.push('## 建議');
  if (obj.shouldRunFull) {
    lines.push(
      '- 建議跑 full intake（入口/設定/測試拓樸有變更，或更動範圍過大）'
    );
  } else {
    lines.push(
      '- 只看 delta 就夠：可直接進入「需求檔/變更檔」或只重跑受影響的 tests'
    );
  }
  lines.push('');

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const r = run('git', ['diff', '--name-status', `${args.base}..HEAD`]);
  if (!r.ok) {
    const fallback = {
      base: args.base,
      shouldRunFull: true,
      reasons: ['git-diff-failed'],
      changedFiles: { added: [], modified: [], deleted: [], renamed: [] },
      error: r.stderr || 'git diff failed',
    };
    process.stdout.write(
      args.format === 'json'
        ? JSON.stringify(fallback, null, 2)
        : renderMd(fallback)
    );
    process.exit(0);
  }

  const lines = r.stdout
    ? r.stdout
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
    : [];
  const changed = classifyNameStatus(lines);

  const allChanged = [
    ...changed.added,
    ...changed.modified,
    ...changed.deleted,
    ...changed.renamed.flatMap(x => [x.from, x.to]),
  ].filter(Boolean);

  const reasons = [];
  let shouldRunFull = false;

  const topoHits = allChanged.filter(isTopologyFile);
  if (topoHits.length) {
    shouldRunFull = true;
    reasons.push('topology-changed');
  }

  if (allChanged.length >= 80) {
    shouldRunFull = true;
    reasons.push('large-diff');
  }

  const isDocsOnly =
    allChanged.length > 0 &&
    allChanged.every(p => {
      const low = p.toLowerCase();
      return (
        low.endsWith('.md') ||
        low.endsWith('.mdx') ||
        low.startsWith('docs/') ||
        low.includes('/docs/')
      );
    });
  if (isDocsOnly) {
    shouldRunFull = false;
    reasons.push('docs-only');
  }

  const out = {
    base: args.base,
    shouldRunFull,
    reasons,
    changedFiles: changed,
  };

  process.stdout.write(
    args.format === 'json' ? JSON.stringify(out, null, 2) : renderMd(out)
  );
}

main();
