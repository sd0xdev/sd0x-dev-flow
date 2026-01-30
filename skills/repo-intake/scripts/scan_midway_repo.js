#!/usr/bin/env node
/**
 * scan_midway_repo.js
 * Full repo intake scanner (Node.js + MidwayJS optimized)
 *
 * Output:
 *  - --format md (default): human report
 *  - --format json: structured report for downstream tooling
 *
 * Notes:
 *  - Prefers `git ls-files` to avoid node_modules
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.next',
  '.turbo',
  '.cache',
  '.idea',
  '.vscode',
  'coverage',
  '.coverage',
  '.mypy_cache',
]);

const DOC_EXTS = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc']);
const DOC_BASENAMES_PRIORITY = [
  'readme',
  'architecture',
  'design',
  'spec',
  'requirements',
  'rfc',
  'adr',
  'contributing',
  'roadmap',
  'overview',
  'runbook',
];

const BUILD_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'midway.config.ts',
  'midway.config.js',
  'bootstrap.js',
  'bootstrap.ts',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Makefile',
  'justfile',
];

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

function detectRepoRoot(startCwd) {
  const r = run('git', ['rev-parse', '--show-toplevel'], startCwd);
  if (r.ok && r.stdout) return { root: r.stdout, hasGit: true };
  return { root: startCwd, hasGit: false };
}

function gitLsFiles(root) {
  const r = run('git', ['ls-files'], root);
  if (!r.ok) return null;
  if (!r.stdout) return [];
  return r.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

function walkFiles(root) {
  const out = [];
  function walk(dirRel) {
    const abs = path.join(root, dirRel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      const rel = path.join(dirRel, ent.name);
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) continue;
        walk(rel);
      } else if (ent.isFile()) {
        out.push(rel.split(path.sep).join('/'));
      }
    }
  }
  walk('');
  return out.filter(Boolean);
}

function isProbablyDoc(p) {
  const low = p.toLowerCase();
  const ext = path.extname(low);
  if (!DOC_EXTS.has(ext)) return false;

  if (low === 'readme.md' || low.startsWith('readme.')) return true;
  if (low.startsWith('docs/') || low.includes('/docs/')) return true;
  if (low.startsWith('doc/') || low.includes('/doc/')) return true;

  const base = path.basename(low, ext);
  return DOC_BASENAMES_PRIORITY.some(k => base.includes(k));
}

function scoreDoc(p) {
  const low = p.toLowerCase();
  const ext = path.extname(low);
  const base = path.basename(low, ext);

  let score = 0;
  if (low === 'readme.md' || base.startsWith('readme')) score += 200;
  if (low.startsWith('docs/')) score += 120;
  if (low.includes('/docs/')) score += 90;
  if (
    [
      'architecture',
      'design',
      'spec',
      'requirements',
      'rfc',
      'adr',
      'runbook',
    ].some(k => base.includes(k))
  )
    score += 50;
  if (DOC_BASENAMES_PRIORITY.some(k => base.includes(k))) score += 20;
  return score;
}

function docBucketKey(p) {
  const parts = p.split('/').filter(Boolean);
  if (!parts.length) return null;
  const keyParts = parts.slice(0, Math.min(3, parts.length));
  return keyParts.join('/');
}

function summarizeDocs(docCandidates) {
  const buckets = new Map();
  for (const p of docCandidates) {
    const key = docBucketKey(p);
    if (!key) continue;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const total = docCandidates.length;
  return { total, buckets };
}

function listReadmes(files) {
  const out = [];
  for (const p of files) {
    const base = path.basename(p).toLowerCase();
    if (base === 'readme' || base.startsWith('readme.')) out.push(p);
  }
  return [...new Set(out)].sort();
}

function readJsonSafe(absPath) {
  try {
    const txt = fs.readFileSync(absPath, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function detectPackageManager(filesSet) {
  if (filesSet.has('pnpm-lock.yaml')) return 'pnpm';
  if (filesSet.has('yarn.lock')) return 'yarn';
  if (filesSet.has('package-lock.json')) return 'npm';
  return 'npm';
}

function findAllPackageJson(files) {
  return files.filter(f => f.endsWith('package.json'));
}

function isMidwayProject(filesSet, pkg) {
  if (
    filesSet.has('src/configuration.ts') ||
    filesSet.has('src/configuration.js')
  )
    return true;
  if (!pkg) return false;

  const deps = Object.assign(
    {},
    pkg.dependencies || {},
    pkg.devDependencies || {}
  );
  const names = Object.keys(deps);

  if (names.some(n => n.startsWith('@midwayjs/'))) return true;
  if (names.some(n => n.includes('midway-bin') || n === 'midway')) return true;
  return false;
}

function detectTestRunner(pkg) {
  if (!pkg) return { runner: 'unknown', evidence: [] };

  const deps = Object.assign(
    {},
    pkg.dependencies || {},
    pkg.devDependencies || {}
  );
  const scripts = pkg.scripts || {};
  const evidence = [];

  const has = name => Object.prototype.hasOwnProperty.call(deps, name);

  if (has('jest') || has('ts-jest') || has('@types/jest'))
    evidence.push('deps:jest');
  if (has('mocha') || has('@types/mocha')) evidence.push('deps:mocha');

  const scriptVals = Object.values(scripts).join(' || ').toLowerCase();
  if (scriptVals.includes('midway-bin test'))
    evidence.push('scripts:midway-bin test');
  if (scriptVals.includes('jest')) evidence.push('scripts:jest');
  if (scriptVals.includes('mocha')) evidence.push('scripts:mocha');

  let runner = 'unknown';
  if (
    evidence.some(e => e.includes('jest')) &&
    !evidence.some(e => e.includes('mocha'))
  )
    runner = 'jest';
  if (
    evidence.some(e => e.includes('mocha')) &&
    !evidence.some(e => e.includes('jest'))
  )
    runner = 'mocha';
  if (
    evidence.some(e => e.includes('jest')) &&
    evidence.some(e => e.includes('mocha'))
  )
    runner = 'mixed';

  return { runner, evidence };
}

function scoreEntry(p) {
  const low = p.toLowerCase();
  let score = 0;

  if (low === 'src/configuration.ts' || low === 'src/configuration.js')
    score += 300;
  if (low === 'bootstrap.js' || low === 'bootstrap.ts') score += 260;
  if (low === 'midway.config.ts' || low === 'midway.config.js') score += 180;

  const base = path.basename(low);
  if (
    [
      'main.ts',
      'main.js',
      'index.ts',
      'index.js',
      'app.ts',
      'app.js',
      'server.ts',
      'server.js',
    ].includes(base)
  ) {
    score += 80;
    if (!low.includes('/')) score += 50;
    if (low.startsWith('src/')) score += 30;
  }
  return score;
}

function topDirs(files, topN) {
  const c = new Map();
  for (const f of files) {
    if (!f) continue;
    if (f.startsWith('.')) continue;
    const parts = f.split('/');
    if (parts.length < 2) continue;
    const d = parts[0];
    if (IGNORE_DIRS.has(d)) continue;
    c.set(d, (c.get(d) || 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
}

function isTestFile(p) {
  const low = p.toLowerCase();
  return (
    /(^|\/)test\/unit\//.test(low) ||
    /(^|\/)test\/integration\//.test(low) ||
    /(^|\/)test\/e2e\//.test(low)
  );
}

function classifyTestByContent(root, relPath) {
  const abs = path.join(root, relPath.split('/').join(path.sep));
  let buf;
  try {
    buf = fs.readFileSync(abs, 'utf8');
  } catch {
    return { kind: 'unit', signals: ['read-failed'] };
  }

  const s = buf.slice(0, 200_000);

  const hasCreateApp = /\bcreateApp\s*\(/.test(s);
  const hasCreateHttpRequest = /\bcreateHttpRequest\s*\(/.test(s);
  const hasCreateBootstrap = /\bcreateBootstrap\s*\(/.test(s);
  const mentionsBootstrapEntry = /bootstrap\.(js|ts)/.test(s);
  const importsMock = s.includes('@midwayjs/mock');

  if (hasCreateBootstrap && mentionsBootstrapEntry) {
    return { kind: 'e2e', signals: ['createBootstrap', 'bootstrap.js/ts'] };
  }

  if (hasCreateHttpRequest || hasCreateApp || importsMock) {
    const sig = [];
    if (hasCreateApp) sig.push('createApp');
    if (hasCreateHttpRequest) sig.push('createHttpRequest');
    if (importsMock) sig.push('@midwayjs/mock');
    return { kind: 'integration', signals: sig };
  }

  return { kind: 'unit', signals: [] };
}

function groupTests(root, files, topN) {
  const groups = { unit: [], integration: [], e2e: [] };
  const evidence = { unit: {}, integration: {}, e2e: {} };
  const buckets = { unit: new Map(), integration: new Map(), e2e: new Map() };

  function bucketKey(p) {
    const low = p.toLowerCase();
    const m = low.match(/(^|\/)test\/(unit|integration|e2e)\/([^/]+)/);
    if (m) return `test/${m[2]}/${m[3]}`;
    const m2 = low.match(/(^|\/)test\/(unit|integration|e2e)\//);
    if (m2) return `test/${m2[2]}/(root)`;
    return null;
  }

  for (const f of files) {
    if (!isTestFile(f)) continue;

    const low = f.toLowerCase();
    let kind = null;
    let signals = [];

    if (/(^|\/)test\/e2e\//.test(low)) {
      kind = 'e2e';
      signals = ['path:test/e2e'];
    } else if (/(^|\/)test\/integration\//.test(low)) {
      kind = 'integration';
      signals = ['path:test/integration'];
    } else if (/(^|\/)test\/unit\//.test(low)) {
      kind = 'unit';
      signals = ['path:test/unit'];
    }

    groups[kind].push(f);
    if (signals.length) evidence[kind][f] = signals;
    const b = bucketKey(f);
    if (b) buckets[kind].set(b, (buckets[kind].get(b) || 0) + 1);
  }

  const counts = {
    unit: groups.unit.length,
    integration: groups.integration.length,
    e2e: groups.e2e.length,
  };

  for (const k of Object.keys(groups)) {
    groups[k].sort();
    groups[k] = groups[k].slice(0, topN);
  }

  return { groups, evidence, counts, buckets };
}

function detectE2EToolMarkers(files) {
  const markers = [];
  for (const f of files) {
    const low = f.toLowerCase();
    if (low.includes('playwright.config')) markers.push(f);
    if (low.includes('cypress.config')) markers.push(f);
    if (low.includes('wdio.conf')) markers.push(f);
  }
  return [...new Set(markers)].sort().slice(0, 10);
}

function pickScripts(pkg) {
  const scripts =
    pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : null;
  if (!scripts) return null;

  const picked = {};
  for (const k of Object.keys(scripts).sort()) {
    const lk = k.toLowerCase();
    if (
      ['dev', 'start', 'build', 'test', 'lint', 'cov'].includes(lk) ||
      lk.includes('test') ||
      lk.startsWith('lint:') ||
      lk.includes('lint') // ✅ 把 lint:fix 收進來
    ) {
      picked[k] = scripts[k];
    }
  }
  return picked;
}

function runScriptCmd(pm, name) {
  if (!name) return null;
  if (pm === 'yarn') return `yarn ${name}`;
  if (pm === 'pnpm') return `pnpm ${name}`;
  return `npm run ${name}`;
}

function detectPreCommitSuite(pm, pkg) {
  const s = pkg?.scripts || {};
  const trio = ['lint:fix', 'build', 'test:unit'];
  if (trio.every(k => typeof s[k] === 'string' && s[k].trim())) {
    return trio.map(k => runScriptCmd(pm, k)).join(' && ');
  }
  return null;
}

function parseTestEnv(cmd) {
  if (!cmd) return null;
  const m = cmd.match(/\bTEST_ENV=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function detectSingleTestRecipes(pkg, testRunner) {
  if (!testRunner || testRunner.runner !== 'jest') return {};
  const s = pkg?.scripts || {};
  const unitEnv = parseTestEnv(s['test:unit']);
  const intEnv = parseTestEnv(s['test:integration']);
  const e2eEnv = parseTestEnv(s['test:e2e']);

  return {
    unit: `${
      unitEnv ? `TEST_ENV=${unitEnv} ` : ''
    }npx jest test/unit/provider/yourchain.test.ts`,
    integration: `${
      intEnv ? `TEST_ENV=${intEnv} ` : 'TEST_ENV=integration '
    }npx jest test/integration/chains/yourchain.test.ts -i`,
    e2e: `${
      e2eEnv ? `TEST_ENV=${e2eEnv} ` : 'TEST_ENV=e2e '
    }npx jest test/e2e/yourchain.test.ts`,
  };
}

function renderMd(report) {
  const {
    now,
    root,
    hasGit,
    isMidway,
    packageManager,
    testRunner,
    buildFiles,
    docs,
    docCounts,
    docBuckets,
    readmePaths,
    readmeCount,
    entrypoints,
    dirs,
    midwayHints,
    scripts,
    tests,
    testEvidence,
    e2eMarkers,
    preCommit,
    singleTest,
    testCounts,
    testBuckets,
    topN,
  } = report;

  const lines = [];
  lines.push(`# Repo Intake 報告（MidwayJS 最佳化 / Full）`);
  lines.push(`- 產生時間：${now}`);
  lines.push(`- Repo root：\`${root}\``);
  lines.push(
    `- Git：${hasGit ? '是（git ls-files）' : '否（fallback 走檔案系統掃描）'}`
  );
  lines.push('');

  lines.push('## 1) 專案概覽');
  if (preCommit) lines.push(`- 提交前必跑（pre-commit）：\`${preCommit}\``);

  lines.push(
    `- 判定：${
      isMidway
        ? '**MidwayJS 專案**'
        : '未明確判定 Midway（仍用 Node heuristics 掃描）'
    }`
  );
  lines.push(`- package manager 推測：\`${packageManager}\``);
  lines.push(
    `- 測試 runner 推測：\`${testRunner.runner}\`（線索：${
      (testRunner.evidence || []).join(', ') || '無'
    }）`
  );
  if (buildFiles.length)
    lines.push(
      `- 常見 build/設定檔：${buildFiles.map(f => `\`${f}\``).join(' ')}`
    );
  if (scripts && Object.keys(scripts).length) {
    lines.push('- package.json scripts（節選）：');
    for (const [k, v] of Object.entries(scripts))
      lines.push(`  - \`${k}\`: \`${v}\``);
  } else {
    lines.push('- package.json scripts：未讀到或不存在');
  }
  lines.push('');

  lines.push('## 2) 文件地圖（Docs first）');
  const docBucketList = (m, limit) => {
    if (!m) return [];
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([k, n]) => `\`${k}\` × ${n}`);
  };
  if (docCounts > 0) {
    lines.push(`- 文件總數：${docCounts}`);
    lines.push(`- README 數量：${readmeCount}`);
    if (readmePaths && readmePaths.length) {
      lines.push(`- README 位置（Top ${topN}）：`);
      for (const p of readmePaths.slice(0, topN)) lines.push(`  - \`${p}\``);
      if (readmePaths.length > topN)
        lines.push(`  - （其餘 ${readmePaths.length - topN} 省略）`);
    }
    const buckets = docBucketList(docBuckets, topN);
    if (buckets.length) {
      lines.push(`- 主要資料夾（第 3 層 / Top ${topN}）：`);
      for (const b of buckets) lines.push(`  - ${b}`);
    }
    lines.push('');
    lines.push(
      '建議閱讀順序：README → /docs 規格 → 架構/ADR/RFC → runbook/部署'
    );
  } else {
    lines.push('- **未在常見位置找到 docs/README/規格文件**（或不是常見格式）');
  }
  lines.push('');

  lines.push('## 3) Midway 地圖（入口 / 設定 / 核心模組）');
  if (midwayHints.length) {
    lines.push('- Midway 關鍵檔線索：');
    for (const h of midwayHints) lines.push(`  - \`${h}\``);
  } else {
    lines.push(
      '- 未找到典型 Midway 關鍵檔（可能是 monorepo 子包，或結構不同）'
    );
  }
  lines.push('');
  lines.push('- 入口候選（Top）：');
  if (entrypoints.length)
    for (const e of entrypoints) lines.push(`  - \`${e}\``);
  else lines.push('  - （未找到明顯入口檔）');

  lines.push('');
  lines.push('- 主要目錄（Top）：');
  for (const [d, n] of dirs) lines.push(`  - \`${d}/\` × ${n}`);
  lines.push('');

  lines.push('## 4) 測試地圖（unit / integration / e2e）');
  if (singleTest.unit) lines.push(`- 單元測試：\`${singleTest.unit}\``);
  if (singleTest.integration)
    lines.push(`- 整合測試：\`${singleTest.integration}\``);
  if (singleTest.e2e) lines.push(`- E2E 測試：\`${singleTest.e2e}\``);
  lines.push('- Integration/E2E 預設單檔執行（/verify --integration/--e2e）');
  lines.push('');

  const bucketList = (m, limit) => {
    if (!m) return [];
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([k, n]) => `\`${k}\` × ${n}`);
  };

  for (const [k, title] of [
    ['unit', '單元測試'],
    ['integration', '整合測試'],
    ['e2e', 'E2E'],
  ]) {
    lines.push(`### ${title}`);
    const total = (testCounts && testCounts[k]) || 0;
    const buckets = bucketList(testBuckets && testBuckets[k], topN);
    if (total) {
      lines.push(`- 檔案數：${total}`);
      if (buckets.length) {
        lines.push(`- 主要資料夾（第 3 層 / Top ${topN}）：`);
        for (const b of buckets) lines.push(`  - ${b}`);
      }
    } else {
      lines.push('- （未找到）');
    }
    lines.push('');
  }
  if (e2eMarkers.length) {
    lines.push('### E2E 工具線索（Playwright/Cypress 等）');
    for (const m of e2eMarkers) lines.push(`- \`${m}\``);
    lines.push('');
  }

  lines.push('## 5) 下一步建議（請選 1 個）');
  lines.push(
    '1. 指定一份 docs（例如 docs/xxx.md）→ 我讀完後輸出「需求拆解 + 任務清單」'
  );
  lines.push(
    '2. 指定入口檔（優先 src/configuration.ts 或 bootstrap.js）→ 我解釋架構與資料流'
  );
  lines.push(
    '3. 指定要跑 unit / integration / e2e → 我幫你整理命令與檢查點（先不自動執行，除非你允許）'
  );
  lines.push('');

  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const getArg = (k, defVal) => {
    const idx = argv.indexOf(k);
    if (idx === -1) return defVal;
    return argv[idx + 1] || defVal;
  };
  const format = getArg('--format', 'md');
  const topN = parseInt(getArg('--top', '12'), 10) || 12;

  const startCwd = process.cwd();
  const { root, hasGit } = detectRepoRoot(startCwd);

  let files = hasGit ? gitLsFiles(root) : null;
  if (!files) files = walkFiles(root);

  files = files.map(f => f.replace(/\\/g, '/')).filter(Boolean);
  const filesSet = new Set(files);

  const allPkgJson = findAllPackageJson(files).sort();
  const rootPkgPath = allPkgJson.includes('package.json')
    ? 'package.json'
    : allPkgJson[0] || null;
  const pkg = rootPkgPath
    ? readJsonSafe(path.join(root, rootPkgPath.split('/').join(path.sep)))
    : null;

  const packageManager = detectPackageManager(filesSet);
  const isMidway = isMidwayProject(filesSet, pkg);
  const testRunner = detectTestRunner(pkg);

  const docCandidates = files.filter(isProbablyDoc);
  docCandidates.sort((a, b) => scoreDoc(b) - scoreDoc(a) || a.localeCompare(b));
  const docs = docCandidates.slice(0, topN);
  const docSummary = summarizeDocs(docCandidates);
  const readmePaths = listReadmes(files);

  const buildFiles = BUILD_FILES.filter(f => filesSet.has(f));

  const entrypoints = files
    .map(f => ({ f, s: scoreEntry(f) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.localeCompare(b.f))
    .slice(0, topN)
    .map(x => x.f);

  const midwayHints = [];
  for (const k of [
    'src/configuration.ts',
    'src/configuration.js',
    'bootstrap.js',
    'bootstrap.ts',
    'midway.config.ts',
    'midway.config.js',
    'src/config/config.default.ts',
    'src/config/config.default.js',
  ]) {
    if (filesSet.has(k)) midwayHints.push(k);
  }
  const otherPkg = allPkgJson.filter(p => p !== rootPkgPath).slice(0, 8);
  for (const p of otherPkg) midwayHints.push(`(monorepo) ${p}`);

  const scripts = pickScripts(pkg);

  const { groups, evidence, counts, buckets } = groupTests(root, files, topN);
  const e2eMarkers = detectE2EToolMarkers(files);

  const preCommit = detectPreCommitSuite(packageManager, pkg);

  const singleTest = detectSingleTestRecipes(pkg, testRunner);

  const report = {
    now: new Date().toISOString(),
    root,
    hasGit,
    isMidway,
    packageManager,
    testRunner,
    buildFiles,
    docs,
    docCounts: docSummary.total,
    docBuckets: docSummary.buckets,
    readmePaths,
    readmeCount: readmePaths.length,
    entrypoints,
    dirs: topDirs(files, 8),
    midwayHints,
    scripts,
    preCommit,
    singleTest,
    tests: groups,
    testEvidence: evidence,
    testCounts: counts,
    testBuckets: buckets,
    e2eMarkers,
    topN,
  };

  if (format === 'json') process.stdout.write(JSON.stringify(report, null, 2));
  else process.stdout.write(renderMd(report));
}

main();
