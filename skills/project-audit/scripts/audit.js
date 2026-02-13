#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runCapture, gitRepoRoot, qualifyCommand } = require('../../../scripts/lib/utils');

// ---------------------------------------------------------------------------
// File classification config (language-agnostic)
// ---------------------------------------------------------------------------
function loadClassification() {
  try {
    const p = path.join(__dirname, '../../../scripts/config/file-classification.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
const CLASSIFICATION = loadClassification();
const IGNORE_PREFIXES = CLASSIFICATION?.ignore_prefixes ?? [
  'node_modules/', 'vendor/', 'dist/', 'build/', 'out/',
  'target/', '.next/', '.nuxt/', '__pycache__/', '.pytest_cache/',
  'venv/', '.venv/', '.git/',
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const FORMAT = process.argv.includes('--markdown') ? 'markdown' : 'json';
const TARGET_DIR = argVal('--dir');

// ---------------------------------------------------------------------------
// Ecosystem detection
// ---------------------------------------------------------------------------
function detectEcosystem(root) {
  const manifests = {
    node: ['package.json'],
    go: ['go.mod'],
    rust: ['Cargo.toml'],
    python: ['pyproject.toml', 'setup.py', 'requirements.txt'],
    java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    ruby: ['Gemfile'],
    php: ['composer.json'],
    dotnet: ['*.csproj', '*.sln'],
  };
  const detected = [];
  for (const [eco, files] of Object.entries(manifests)) {
    for (const pattern of files) {
      if (pattern.includes('*')) {
        const escaped = pattern.replace(/\./g, '\\.').replace('*', '.*');
        const re = new RegExp('^' + escaped + '$');
        if (findFileShallow(root, name => re.test(name))) {
          detected.push(eco);
          break;
        }
      } else {
        try {
          if (fs.statSync(path.join(root, pattern)).isFile()) {
            detected.push(eco);
            break;
          }
        } catch { /* skip */ }
      }
    }
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fileExists(root, ...parts) {
  try {
    return fs.statSync(path.join(root, ...parts)).isFile();
  } catch { return false; }
}

function dirExists(root, ...parts) {
  try {
    return fs.statSync(path.join(root, ...parts)).isDirectory();
  } catch { return false; }
}

function readFileSafe(root, ...parts) {
  try {
    return fs.readFileSync(path.join(root, ...parts), 'utf8');
  } catch { return null; }
}

function readJsonSafe(root, ...parts) {
  const raw = readFileSafe(root, ...parts);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function findFileShallow(root, predicate, maxDepth = 3) {
  function scan(dir, depth) {
    if (depth > maxDepth) return false;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && predicate(entry.name)) return true;
        if (entry.isDirectory() && depth < maxDepth) {
          const rel = path.relative(root, path.join(dir, entry.name));
          if (!IGNORE_PREFIXES.some(p => rel.startsWith(p) || entry.name === p.replace(/\/$/, ''))) {
            if (scan(path.join(dir, entry.name), depth + 1)) return true;
          }
        }
      }
    } catch { /* skip */ }
    return false;
  }
  return scan(root, 0);
}

function countFiles(dir, filter) {
  let count = 0;
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = path.relative(dir, path.join(d, entry.name));
      if (IGNORE_PREFIXES.some(p => rel.startsWith(p) || entry.name === p.replace(/\/$/, ''))) continue;
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else if (!filter || filter(entry.name, rel)) count++;
    }
  }
  walk(dir);
  return count;
}

// ---------------------------------------------------------------------------
// Shared applicability helpers
// ---------------------------------------------------------------------------

function hasNonTestCodeFiles(root) {
  const codeExts = CLASSIFICATION?.code_extensions ?? ['.ts', '.tsx', '.js', '.jsx'];
  const testInd = CLASSIFICATION?.test_gap?.test_indicators ?? {
    directory_prefixes: ['test/', 'tests/', '__tests__/', 'spec/', 'src/test/'],
    file_suffixes: ['.test.ts', '.test.tsx', '.test.js', '.test.jsx', '.spec.ts', '.spec.js', '_test.py', '_spec.rb', 'Test.java', 'Test.kt', '_test.go'],
  };
  return countFiles(root, (name, rel) => {
    const ext = path.extname(name);
    if (!codeExts.includes(ext)) return false;
    const posixRel = rel.split(path.sep).join('/');
    if (testInd.directory_prefixes.some(p => posixRel.startsWith(p))) return false;
    if (testInd.file_suffixes.some(s => name.endsWith(s))) return false;
    return true;
  }) > 0;
}

function isNodeZeroDeps(root) {
  const pkg = readJsonSafe(root, 'package.json');
  if (!pkg) return false;
  if (pkg.workspaces) return false; // workspace roots have deps in child packages
  const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  return fields.every(f => !pkg[f] || Object.keys(pkg[f]).length === 0);
}

function hasRuntimeScripts(root) {
  const pkg = readJsonSafe(root, 'package.json');
  if (!pkg || !pkg.scripts) return false;
  return ['start', 'dev', 'serve'].some(s => typeof pkg.scripts[s] === 'string');
}

function hasTsFiles(root) {
  const tsExts = ['.ts', '.tsx', '.mts', '.cts'];
  return countFiles(root, (name) => tsExts.includes(path.extname(name))) > 0;
}

function isDocsHeavy(root) {
  const docExts = CLASSIFICATION?.doc_extensions ?? ['.md', '.mdx'];
  const codeExts = CLASSIFICATION?.code_extensions ?? ['.ts', '.tsx', '.js', '.jsx'];
  const docs = countFiles(root, (name) => docExts.includes(path.extname(name)));
  const code = countFiles(root, (name) => codeExts.includes(path.extname(name)));
  const total = docs + code;
  if (total === 0) return false;
  return (docs / total) >= 0.6 && docs >= 30;
}

function hasMarkdownLintConfig(root) {
  const configs = ['.markdownlint.json', '.markdownlint.jsonc', '.markdownlint.yaml', '.markdownlint.yml', '.markdownlint-cli2.jsonc', '.markdownlint-cli2.yaml', '.markdownlint-cli2.yml'];
  return configs.some(f => fileExists(root, f));
}

function hasMarkdownLintScript(root) {
  const pkg = readJsonSafe(root, 'package.json');
  if (!pkg || !pkg.scripts) return false;
  const lintKeys = ['lint', 'lint:fix', 'lint:md', 'docs:lint'];
  return lintKeys.some(k => typeof pkg.scripts[k] === 'string' && pkg.scripts[k].includes('markdownlint'));
}

// ---------------------------------------------------------------------------
// 12 Checks
// ---------------------------------------------------------------------------

// OSS-1: LICENSE exists
function checkOssLicense(root) {
  const names = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING'];
  const found = names.some(n => fileExists(root, n));
  return {
    id: 'oss-license',
    dimension: 'oss',
    result: found ? 'pass' : 'fail',
    score: found ? 1 : 0,
    message: found ? 'LICENSE file found' : 'No LICENSE file',
    suggestion: found ? null : 'Add a LICENSE file (MIT, Apache-2.0, etc.)',
    priority: found ? null : 'P1',
  };
}

// OSS-2: README quality
function checkOssReadme(root) {
  const content = readFileSafe(root, 'README.md');
  if (!content) {
    return {
      id: 'oss-readme',
      dimension: 'oss',
      result: 'fail',
      score: 0,
      message: 'No README.md found',
      suggestion: 'Create a README.md with project description, setup, and usage',
      priority: 'P0',
    };
  }
  const lines = content.split('\n').length;
  const sections = (content.match(/^#{1,3}\s/gm) || []).length;
  if (lines >= 50 && sections >= 4) {
    return { id: 'oss-readme', dimension: 'oss', result: 'pass', score: 1, message: `README: ${lines} lines, ${sections} sections`, suggestion: null, priority: null };
  }
  if (lines >= 20 && sections >= 2) {
    return { id: 'oss-readme', dimension: 'oss', result: 'partial', score: 0.5, message: `README sparse: ${lines} lines, ${sections} sections`, suggestion: 'Expand README with more sections (install, usage, API)', priority: 'P2' };
  }
  return { id: 'oss-readme', dimension: 'oss', result: 'fail', score: 0, message: `README minimal: ${lines} lines, ${sections} sections`, suggestion: 'Expand README significantly', priority: 'P1' };
}

// ROBUSTNESS-1: CI config
function checkRobustnessCi(root) {
  const ciPaths = [
    ['.github', 'workflows'],
    ['.gitlab-ci.yml'],
    ['.circleci'],
    ['Jenkinsfile'],
    ['.travis.yml'],
    ['bitbucket-pipelines.yml'],
  ];
  const found = ciPaths.some(parts => {
    const p = path.join(root, ...parts);
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        const files = fs.readdirSync(p);
        return files.some(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      }
      return st.isFile();
    } catch { return false; }
  });
  return {
    id: 'robustness-ci',
    dimension: 'robustness',
    result: found ? 'pass' : 'fail',
    score: found ? 1 : 0,
    message: found ? 'CI configuration found' : 'No CI configuration',
    suggestion: found ? null : 'Add CI workflow (.github/workflows/)',
    priority: found ? null : 'P1',
  };
}

// ROBUSTNESS-2: Lint/typecheck toolchain
function checkRobustnessLintTypecheck(root, ecosystems) {
  // Static-typed languages have built-in checks
  const staticTyped = ['go', 'rust', 'java', 'dotnet'];
  if (ecosystems.some(e => staticTyped.includes(e))) {
    return { id: 'robustness-lint-typecheck', dimension: 'robustness', result: 'pass', score: 1, message: 'Static-typed language with built-in checks', suggestion: null, priority: null };
  }

  // Docs-heavy profile — markdown lint is the appropriate lint tool.
  // Design: per brainstorm Nash Equilibrium, docs-heavy projects (>=60% docs, >=30 files)
  // use markdownlint as their primary lint tool. No markdownlint signals → fall through
  // to existing Node/Python checks (non-exclusive, prevents regression).
  if (isDocsHeavy(root)) {
    const scriptSig = hasMarkdownLintScript(root);
    const configSig = hasMarkdownLintConfig(root);
    if (scriptSig && configSig) {
      return { id: 'robustness-lint-typecheck', dimension: 'robustness', result: 'pass', score: 1, message: 'Docs-heavy project with markdown lint configured', suggestion: null, priority: null };
    }
    if (scriptSig || configSig) {
      return { id: 'robustness-lint-typecheck', dimension: 'robustness', result: 'partial', score: 0.5, message: `Docs-heavy: script=${scriptSig}, config=${configSig}`, suggestion: 'Add both markdownlint config and script', priority: 'P2' };
    }
    // No markdownlint signals — fall through to existing checks
  }

  const pkg = readJsonSafe(root, 'package.json');
  if (pkg && pkg.scripts) {
    const hasLint = !!(pkg.scripts.lint || pkg.scripts['lint:fix']);
    const hasTypecheck = !!(pkg.scripts.typecheck || pkg.scripts['type-check']);
    const hasTsconfig = fileExists(root, 'tsconfig.json');
    if (hasLint && (hasTypecheck || hasTsconfig)) {
      return { id: 'robustness-lint-typecheck', dimension: 'robustness', result: 'pass', score: 1, message: 'Lint + typecheck configured', suggestion: null, priority: null };
    }
    if (hasLint || hasTsconfig) {
      return { id: 'robustness-lint-typecheck', dimension: 'robustness', result: 'partial', score: 0.5, message: `Partial: lint=${hasLint}, typecheck=${hasTypecheck || hasTsconfig}`, suggestion: 'Add both lint and typecheck scripts', priority: 'P2' };
    }
  }

  // Python: check for ruff/flake8/pylint + mypy/pyright configs
  if (ecosystems.includes('python')) {
    const hasLint = fileExists(root, '.flake8') || fileExists(root, 'ruff.toml') || fileExists(root, '.ruff.toml');
    const hasType = fileExists(root, 'pyrightconfig.json') || fileExists(root, 'mypy.ini');
    if (hasLint && hasType) return { id: 'robustness-lint-typecheck', dimension: 'robustness', result: 'pass', score: 1, message: 'Python lint + type checking configured', suggestion: null, priority: null };
    if (hasLint || hasType) return { id: 'robustness-lint-typecheck', dimension: 'robustness', result: 'partial', score: 0.5, message: 'Partial Python toolchain', suggestion: 'Add both linter and type checker', priority: 'P2' };
  }

  return { id: 'robustness-lint-typecheck', dimension: 'robustness', result: 'fail', score: 0, message: 'No lint/typecheck toolchain detected', suggestion: 'Add ESLint + TypeScript or equivalent', priority: 'P1' };
}

// ROBUSTNESS-3: Test file ratio
function checkRobustnessTestRatio(root) {
  const testIndicators = CLASSIFICATION?.test_gap?.test_indicators ?? {
    directory_prefixes: ['test/', 'tests/', '__tests__/', 'spec/', 'src/test/'],
    file_suffixes: ['.test.ts', '.test.tsx', '.test.js', '.test.jsx', '.spec.ts', '.spec.js', '_test.py', '_spec.rb', 'Test.java', 'Test.kt', '_test.go'],
  };

  const srcCount = countFiles(root, (name, rel) => {
    const ext = path.extname(name);
    const codeExts = CLASSIFICATION?.code_extensions ?? ['.ts', '.tsx', '.js', '.jsx'];
    if (!codeExts.includes(ext)) return false;
    if (testIndicators.directory_prefixes.some(p => rel.startsWith(p))) return false;
    if (testIndicators.file_suffixes.some(s => name.endsWith(s))) return false;
    return true;
  });

  const testCount = countFiles(root, (name, rel) => {
    return testIndicators.directory_prefixes.some(p => rel.startsWith(p)) ||
           testIndicators.file_suffixes.some(s => name.endsWith(s));
  });

  if (srcCount === 0) {
    return { id: 'robustness-test-ratio', dimension: 'robustness', result: 'n/a', score: null, message: 'No source files detected', suggestion: null, priority: null };
  }

  const ratio = testCount / srcCount;
  const pct = Math.round(ratio * 100);
  if (ratio >= 0.3) {
    return { id: 'robustness-test-ratio', dimension: 'robustness', result: 'pass', score: 1, message: `Test ratio: ${pct}% (${testCount}/${srcCount})`, suggestion: null, priority: null };
  }
  if (ratio >= 0.1) {
    return { id: 'robustness-test-ratio', dimension: 'robustness', result: 'partial', score: 0.5, message: `Test ratio: ${pct}% (${testCount}/${srcCount})`, suggestion: 'Increase test coverage to ≥30%', priority: 'P2' };
  }
  return { id: 'robustness-test-ratio', dimension: 'robustness', result: 'fail', score: 0, message: `Test ratio: ${pct}% (${testCount}/${srcCount})`, suggestion: 'Add tests — current coverage is very low', priority: 'P1' };
}

// SCOPE-1: Declared vs implemented
function checkScopeDeclaredImpl(root) {
  const hasFeatureDocs = dirExists(root, 'docs', 'features');
  if (!hasFeatureDocs) {
    return { id: 'scope-declared-impl', dimension: 'scope', result: 'n/a', score: null, message: 'No docs/features/ directory', suggestion: null, priority: null };
  }
  const hasCode = hasNonTestCodeFiles(root);
  if (!hasCode) {
    return { id: 'scope-declared-impl', dimension: 'scope', result: 'fail', score: 0, message: 'Feature docs exist but no source code found (excluding tests)', suggestion: 'Add implementation code for declared features', priority: 'P1' };
  }
  return { id: 'scope-declared-impl', dimension: 'scope', result: 'pass', score: 1, message: 'Feature docs and source code both exist', suggestion: null, priority: null };
}

// SCOPE-2: AC completion rate
function checkScopeAcCompletion(root) {
  const featuresDir = path.join(root, 'docs', 'features');
  if (!dirExists(root, 'docs', 'features')) {
    return { id: 'scope-ac-completion', dimension: 'scope', result: 'n/a', score: null, message: 'No docs/features/ directory', suggestion: null, priority: null };
  }

  let totalChecked = 0;
  let totalUnchecked = 0;

  function scanDir(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) scanDir(path.join(dir, entry.name));
      else if (entry.name.endsWith('.md')) {
        const content = readFileSafe(dir, entry.name);
        if (content) {
          totalChecked += (content.match(/- \[x\]/gi) || []).length;
          totalUnchecked += (content.match(/- \[ \]/g) || []).length;
        }
      }
    }
  }
  scanDir(featuresDir);

  const total = totalChecked + totalUnchecked;
  if (total === 0) {
    return { id: 'scope-ac-completion', dimension: 'scope', result: 'n/a', score: null, message: 'No acceptance criteria found', suggestion: null, priority: null };
  }
  const rate = totalChecked / total;
  const pct = Math.round(rate * 100);
  if (rate >= 0.8) {
    return { id: 'scope-ac-completion', dimension: 'scope', result: 'pass', score: 1, message: `AC completion: ${pct}% (${totalChecked}/${total})`, suggestion: null, priority: null };
  }
  if (rate >= 0.5) {
    return { id: 'scope-ac-completion', dimension: 'scope', result: 'partial', score: 0.5, message: `AC completion: ${pct}% (${totalChecked}/${total})`, suggestion: 'Complete more acceptance criteria', priority: 'P2' };
  }
  return { id: 'scope-ac-completion', dimension: 'scope', result: 'fail', score: 0, message: `AC completion: ${pct}% (${totalChecked}/${total})`, suggestion: 'Many acceptance criteria incomplete — review scope', priority: 'P1' };
}

// RUNNABILITY-1: Manifest exists
function checkRunnabilityManifest(root) {
  const manifests = ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'requirements.txt', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json'];
  let found = manifests.some(m => fileExists(root, m));
  // Dotnet uses glob patterns — shallow recursive check for *.csproj / *.sln
  if (!found) {
    found = findFileShallow(root, name => name.endsWith('.csproj') || name.endsWith('.sln'));
  }
  return {
    id: 'runnability-manifest',
    dimension: 'runnability',
    result: found ? 'pass' : 'fail',
    score: found ? 1 : 0,
    message: found ? 'Package manifest found' : 'No package manifest (package.json, go.mod, Cargo.toml, etc.)',
    suggestion: found ? null : 'Add a package manifest file',
    priority: found ? null : 'P0',
  };
}

// RUNNABILITY-2: Runnable scripts
function checkRunnabilityScripts(root, ecosystems) {
  const pkg = readJsonSafe(root, 'package.json');
  if (!pkg) {
    // Non-Node ecosystems: check for Makefile or standard entry points
    if (ecosystems.includes('go') || ecosystems.includes('rust')) {
      return { id: 'runnability-scripts', dimension: 'runnability', result: 'n/a', score: null, message: 'Non-Node ecosystem — standard build tools apply', suggestion: null, priority: null };
    }
    if (fileExists(root, 'Makefile')) {
      return { id: 'runnability-scripts', dimension: 'runnability', result: 'pass', score: 1, message: 'Makefile found', suggestion: null, priority: null };
    }
    return { id: 'runnability-scripts', dimension: 'runnability', result: 'n/a', score: null, message: 'No package.json to check scripts', suggestion: null, priority: null };
  }

  const scripts = pkg.scripts || {};
  const runtimeIndicators = ['start', 'dev', 'serve'];
  const isRuntime = runtimeIndicators.some(s => typeof scripts[s] === 'string');

  if (isRuntime) {
    // Runtime project: require ≥3 of start/dev/build/test (serve is detection-only)
    const key_scripts = ['start', 'dev', 'build', 'test'];
    const found = key_scripts.filter(s => typeof scripts[s] === 'string');
    if (found.length >= 3) {
      return { id: 'runnability-scripts', dimension: 'runnability', result: 'pass', score: 1, message: `Runtime scripts: ${found.join(', ')}`, suggestion: null, priority: null };
    }
    if (found.length >= 1) {
      const missing = key_scripts.filter(s => !found.includes(s));
      return { id: 'runnability-scripts', dimension: 'runnability', result: 'partial', score: 0.5, message: `Scripts: ${found.join(', ')} (missing: ${missing.join(', ')})`, suggestion: `Add missing scripts: ${missing.join(', ')}`, priority: 'P2' };
    }
    // Runtime detected (via serve) but no standard scripts
    return { id: 'runnability-scripts', dimension: 'runnability', result: 'partial', score: 0.5, message: 'Runtime detected (serve) but missing start/dev/build/test', suggestion: 'Add start, dev, build, test scripts', priority: 'P2' };
  }

  // Non-runtime project: only require test
  if (typeof scripts.test === 'string') {
    return { id: 'runnability-scripts', dimension: 'runnability', result: 'pass', score: 1, message: 'Non-runtime project with test script', suggestion: null, priority: null };
  }
  const availableScripts = ['build', 'test', 'lint'].filter(s => typeof scripts[s] === 'string');
  if (availableScripts.length > 0) {
    return { id: 'runnability-scripts', dimension: 'runnability', result: 'partial', score: 0.5, message: `Non-runtime scripts: ${availableScripts.join(', ')} (missing: test)`, suggestion: 'Add a test script', priority: 'P2' };
  }
  return { id: 'runnability-scripts', dimension: 'runnability', result: 'fail', score: 0, message: 'No scripts in package.json', suggestion: 'Add at least a test script', priority: 'P1' };
}

// RUNNABILITY-3: .env.example / docker-compose
function checkRunnabilityEnvDocker(root, ecosystems) {
  // Node-only + zero deps + no runtime scripts → env/docker not applicable
  if (ecosystems.includes('node') && ecosystems.length === 1 && isNodeZeroDeps(root) && !hasRuntimeScripts(root)) {
    return { id: 'runnability-env-docker', dimension: 'runnability', result: 'n/a', score: null, message: 'No dependencies and no runtime scripts — env/docker not applicable', suggestion: null, priority: null };
  }
  const hasEnv = fileExists(root, '.env.example') || fileExists(root, '.env.sample') || fileExists(root, '.env.template');
  const hasDocker = fileExists(root, 'docker-compose.yml') || fileExists(root, 'docker-compose.yaml') || fileExists(root, 'Dockerfile');
  if (hasEnv || hasDocker) {
    return { id: 'runnability-env-docker', dimension: 'runnability', result: 'pass', score: 1, message: `env-example=${hasEnv}, docker=${hasDocker}`, suggestion: null, priority: null };
  }
  return { id: 'runnability-env-docker', dimension: 'runnability', result: 'fail', score: 0, message: 'No .env.example or Docker config', suggestion: 'Add .env.example for environment setup or Docker config', priority: 'P2' };
}

// STABILITY-1: Lock file + audit
function checkStabilityLockAudit(root, ecosystems) {
  // Node-only: zero deps → lock file not applicable
  if (ecosystems.includes('node') && ecosystems.length === 1 && isNodeZeroDeps(root)) {
    return { id: 'stability-lock-audit', dimension: 'stability', result: 'n/a', score: null, message: 'Node project with zero dependencies — lock file not applicable', suggestion: null, priority: null };
  }
  // Per-ecosystem lock file mapping (avoids cross-contamination, e.g. go.mod + package-lock.json)
  const ecoLockMap = {
    node: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'],
    rust: ['Cargo.lock'],
    go: ['go.sum'],
    ruby: ['Gemfile.lock'],
    php: ['composer.lock'],
  };
  const hasMatchingLock = ecosystems.some(eco => (ecoLockMap[eco] || []).some(f => fileExists(root, f)));
  const allLockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'go.sum', 'Gemfile.lock', 'composer.lock'];
  const hasAnyLock = allLockFiles.some(f => fileExists(root, f));
  // Node: check package.json scripts for audit
  const pkg = readJsonSafe(root, 'package.json');
  const hasNodeAudit = pkg && pkg.scripts && (typeof pkg.scripts.audit === 'string' || typeof pkg.scripts['dep-audit'] === 'string');
  // Non-Node ecosystems have built-in audit tools (go mod tidy, cargo audit, etc.)
  const builtinAudit = ['go', 'rust', 'java', 'dotnet'];
  const hasBuiltinAudit = ecosystems.some(e => builtinAudit.includes(e));
  if (hasMatchingLock && (hasNodeAudit || hasBuiltinAudit)) {
    return { id: 'stability-lock-audit', dimension: 'stability', result: 'pass', score: 1, message: 'Lock file + audit tooling found', suggestion: null, priority: null };
  }
  if (hasAnyLock) {
    return { id: 'stability-lock-audit', dimension: 'stability', result: 'partial', score: 0.5, message: 'Lock file found, no audit script', suggestion: 'Add an audit script for dependency vulnerability checking', priority: 'P2' };
  }
  return { id: 'stability-lock-audit', dimension: 'stability', result: 'fail', score: 0, message: 'No lock file', suggestion: 'Commit lock file for reproducible builds', priority: 'P1' };
}

// STABILITY-2: Type config
function checkStabilityTypeConfig(root, ecosystems) {
  const staticTyped = ['go', 'rust', 'java', 'dotnet'];
  if (ecosystems.some(e => staticTyped.includes(e))) {
    return { id: 'stability-type-config', dimension: 'stability', result: 'pass', score: 1, message: 'Static-typed language', suggestion: null, priority: null };
  }
  if (fileExists(root, 'tsconfig.json')) {
    return { id: 'stability-type-config', dimension: 'stability', result: 'pass', score: 1, message: 'tsconfig.json found', suggestion: null, priority: null };
  }
  if (fileExists(root, 'jsconfig.json')) {
    return { id: 'stability-type-config', dimension: 'stability', result: 'partial', score: 0.5, message: 'jsconfig.json found (no full type checking)', suggestion: 'Consider migrating to TypeScript', priority: 'P2' };
  }
  // Pure JS project (no TS files) → partial instead of fail
  if (!hasTsFiles(root)) {
    return { id: 'stability-type-config', dimension: 'stability', result: 'partial', score: 0.5, message: 'Pure JavaScript project — no TypeScript files', suggestion: 'Consider adding jsconfig.json or migrating to TypeScript', priority: 'P2' };
  }
  return { id: 'stability-type-config', dimension: 'stability', result: 'fail', score: 0, message: 'TypeScript files found but no tsconfig.json', suggestion: 'Add tsconfig.json for type checking', priority: 'P2' };
}

// ---------------------------------------------------------------------------
// Scoring aggregation
// ---------------------------------------------------------------------------
function aggregateScores(checks) {
  const dims = {};
  for (const c of checks) {
    if (!dims[c.dimension]) dims[c.dimension] = { checks: [], applicable: [] };
    dims[c.dimension].checks.push(c);
    if (c.result !== 'n/a') dims[c.dimension].applicable.push(c);
  }

  const dimensions = {};
  for (const [dim, data] of Object.entries(dims)) {
    const applicableCount = data.applicable.length;
    const totalChecks = data.checks.length;
    if (applicableCount === 0) {
      dimensions[dim] = { score: 0, confidence: 0, total_checks: totalChecks, applicable_checks: 0 };
      continue;
    }
    const sumScore = data.applicable.reduce((s, c) => s + c.score, 0);
    dimensions[dim] = {
      score: Math.round((sumScore / applicableCount) * 100),
      confidence: Math.round((applicableCount / totalChecks) * 100),
      total_checks: totalChecks,
      applicable_checks: applicableCount,
    };
  }

  // Overall: simple average of dimension scores (weighted equally for v1)
  const dimEntries = Object.values(dimensions).filter(d => d.applicable_checks > 0);
  const overall = dimEntries.length > 0
    ? Math.round(dimEntries.reduce((s, d) => s + d.score, 0) / dimEntries.length)
    : 0;

  return { overall, dimensions };
}

function determineStatus(checks) {
  const hasP0 = checks.some(c => c.priority === 'P0');
  const hasP1 = checks.some(c => c.priority === 'P1');
  if (hasP0) return 'Blocked';
  if (hasP1) return 'Needs Work';
  return 'Healthy';
}

function buildFindings(checks) {
  const counts = { p0: 0, p1: 0, p2: 0 };
  for (const c of checks) {
    if (c.priority === 'P0') counts.p0++;
    else if (c.priority === 'P1') counts.p1++;
    else if (c.priority === 'P2') counts.p2++;
  }
  return counts;
}

function buildNextActions(checks) {
  const actions = [];
  const failed = checks.filter(c => c.result === 'fail' || c.result === 'partial');
  // Sort by priority severity
  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  failed.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

  for (const c of failed.slice(0, 5)) {
    const action = { id: c.id, command: null, reason: c.suggestion || c.message, confidence: 0 };
    // Map specific checks to commands
    if (c.id === 'oss-readme') { action.command = qualifyCommand('/update-docs'); action.confidence = 0.8; }
    else if (c.id === 'robustness-ci') { action.confidence = 0.6; }
    else if (c.id === 'robustness-test-ratio') { action.command = qualifyCommand('/codex-test-gen'); action.confidence = 0.7; }
    else if (c.id === 'runnability-manifest') { action.confidence = 0.9; }
    else { action.confidence = 0.5; }
    actions.push(action);
  }

  // If ≥3 P0+P1 findings, suggest /create-request
  const p0p1Count = checks.filter(c => c.priority === 'P0' || c.priority === 'P1').length;
  if (p0p1Count >= 3) {
    actions.push({
      id: 'create-request',
      command: qualifyCommand('/create-request'),
      reason: `${p0p1Count} critical findings — create a request to track remediation`,
      confidence: 0.7,
    });
  }

  actions.sort((a, b) => b.confidence - a.confidence);
  return actions;
}

// ---------------------------------------------------------------------------
// Main audit
// ---------------------------------------------------------------------------
function runAudit(root) {
  const ecosystems = detectEcosystem(root);
  const checks = [
    checkOssLicense(root),
    checkOssReadme(root),
    checkRobustnessCi(root),
    checkRobustnessLintTypecheck(root, ecosystems),
    checkRobustnessTestRatio(root),
    checkScopeDeclaredImpl(root),
    checkScopeAcCompletion(root),
    checkRunnabilityManifest(root),
    checkRunnabilityScripts(root, ecosystems),
    checkRunnabilityEnvDocker(root, ecosystems),
    checkStabilityLockAudit(root, ecosystems),
    checkStabilityTypeConfig(root, ecosystems),
  ];

  const { overall, dimensions } = aggregateScores(checks);
  const status = determineStatus(checks);
  const findings = buildFindings(checks);
  const next_actions = buildNextActions(checks);

  return {
    version: 1,
    repo: path.basename(root),
    overall_score: overall,
    status,
    dimensions,
    checks,
    findings,
    next_actions,
  };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------
function formatMarkdown(output) {
  const lines = [];
  const icon = output.status === 'Healthy' ? '✅' : output.status === 'Needs Work' ? '⚠️' : '⛔';

  lines.push('## Project Audit Report');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Repo | ${output.repo} |`);
  lines.push(`| Score | **${output.overall_score}/100** |`);
  lines.push(`| Status | ${icon} ${output.status} |`);
  lines.push(`| Findings | P0: ${output.findings.p0}, P1: ${output.findings.p1}, P2: ${output.findings.p2} |`);
  lines.push('');

  // Dimensions
  lines.push('### Dimensions');
  lines.push('');
  lines.push('| Dimension | Score | Confidence | Checks |');
  lines.push('|-----------|-------|------------|--------|');
  for (const [dim, data] of Object.entries(output.dimensions)) {
    lines.push(`| ${dim} | ${data.score}/100 | ${data.confidence}% | ${data.applicable_checks}/${data.total_checks} |`);
  }
  lines.push('');

  // Checks
  lines.push('### Checks');
  lines.push('');
  for (const c of output.checks) {
    const icon = c.result === 'pass' ? '✅' : c.result === 'partial' ? '⚠️' : c.result === 'fail' ? '❌' : '➖';
    const priority = c.priority ? ` [${c.priority}]` : '';
    lines.push(`- ${icon} **${c.id}**${priority} — ${c.message}`);
    if (c.suggestion) lines.push(`  → ${c.suggestion}`);
  }
  lines.push('');

  // Next actions
  if (output.next_actions.length > 0) {
    lines.push('### Next Actions');
    lines.push('');
    for (const a of output.next_actions) {
      const cmd = a.command ? `\`${a.command}\`` : '(manual)';
      lines.push(`- ${cmd} — ${a.reason}`);
    }
    lines.push('');
  }

  // Gate sentinel
  if (output.status === 'Healthy') {
    lines.push('## Gate: ✅');
  } else {
    lines.push('## Gate: ⛔');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let root;
  if (TARGET_DIR) {
    root = path.resolve(TARGET_DIR);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      console.error(`Invalid --dir path: ${root} (not a directory)`);
      process.exit(2);
    }
  } else {
    root = await gitRepoRoot();
    if (!root) {
      console.error('Not in a git repository. Use --dir to specify a directory.');
      process.exit(2);
    }
  }

  const output = runAudit(root);

  if (FORMAT === 'markdown') {
    console.log(formatMarkdown(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  // Exit codes: 0 = healthy, 1 = has P1, 2 = has P0
  if (output.findings.p0 > 0) process.exit(2);
  if (output.findings.p1 > 0) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('audit.js error:', err.message);
  process.exit(2);
});
