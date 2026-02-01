const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  symlinkSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../scripts/dep-audit.sh');
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

function linkSystemCommand(binDir, name) {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  if (result.status !== 0) return;
  const target = result.stdout.trim();
  if (!target) return;
  try {
    symlinkSync(target, join(binDir, name));
  } catch {}
}

function setupStubBin(options = {}) {
  const { includeJq = true, includeCoreUtils = false } = options;
  const binDir = makeTempDir('sd0x-stub-bin-');
  const stubAudit = `#!/bin/sh\nif [ \"$1\" = \"audit\" ]; then\n  if [ -n \"$STUB_AUDIT_JSON\" ]; then\n    cat \"$STUB_AUDIT_JSON\"\n  else\n    cat <<'JSON'\n{\"metadata\":{\"vulnerabilities\":{\"critical\":0,\"high\":0,\"moderate\":0,\"low\":0}}}\nJSON\n  fi\n  exit \${STUB_AUDIT_EXIT:-0}\nfi\nexit 0\n`;
  writeExecutable(join(binDir, 'npm'), stubAudit);
  writeExecutable(join(binDir, 'yarn'), stubAudit);
  writeExecutable(join(binDir, 'pnpm'), stubAudit);

  const stubJq = `#!/usr/bin/env node\nconst fs = require('fs');\nconst args = process.argv.slice(2);\nlet query;\nlet file;\nfor (const arg of args) {\n  if (arg === '-r') continue;\n  if (!query) {\n    query = arg;\n    continue;\n  }\n  if (!file) {\n    file = arg;\n    continue;\n  }\n}\nlet input = '';\ntry {\n  input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');\n} catch {}\nlet data = {};\ntry {\n  data = input ? JSON.parse(input) : {};\n} catch {}\nconst match = query && query.match(/\\.metadata\\.vulnerabilities\\.(critical|high|moderate|low)/);\nif (match) {\n  const key = match[1];\n  const val = (((data || {}).metadata || {}).vulnerabilities || {})[key] ?? 0;\n  process.stdout.write(String(val));\n  process.exit(0);\n}\nif (query && query.includes('.data.advisory')) {\n  const advisory = (data && data.data && data.data.advisory) || {};\n  let val = 'Unknown';\n  if (query.includes('.data.advisory.title')) val = advisory.title || 'Unknown';\n  if (query.includes('.data.advisory.severity')) val = advisory.severity || 'unknown';\n  if (query.includes('.data.advisory.module_name')) val = advisory.module_name || 'unknown';\n  if (query.includes('.data.advisory.url')) val = advisory.url || '';\n  process.stdout.write(String(val));\n  process.exit(0);\n}\nprocess.stdout.write('');\n`;
  if (includeJq) writeExecutable(join(binDir, 'jq'), stubJq);

  if (includeCoreUtils) {
    for (const cmd of ['mktemp', 'grep', 'cat', 'rm']) {
      linkSystemCommand(binDir, cmd);
    }
  }

  return binDir;
}

function runDepAudit(cwd, binDir, extraArgs, envOverrides) {
  const baseEnv = { ...process.env, ...envOverrides };
  if (!baseEnv.PATH) {
    baseEnv.PATH = `${binDir}:${process.env.PATH}`;
  } else if (!baseEnv.PATH.split(':').includes(binDir)) {
    baseEnv.PATH = `${binDir}:${baseEnv.PATH}`;
  }
  const result = spawnSync('bash', [scriptPath, ...extraArgs], {
    cwd,
    encoding: 'utf8',
    env: baseEnv,
  });
  return result;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dep-audit fails when vulnerabilities meet default level', () => {
  const workDir = makeTempDir('sd0x-audit-');
  const binDir = setupStubBin();
  const vulnJsonPath = join(workDir, 'vuln.json');
  writeFileSync(
    vulnJsonPath,
    '{"metadata":{"vulnerabilities":{"critical":0,"high":2,"moderate":3,"low":1}}}'
  );

  const result = runDepAudit(workDir, binDir, [], {
    STUB_AUDIT_JSON: vulnJsonPath,
    STUB_AUDIT_EXIT: '1',
  });
  assert.equal(result.status, 1);
});

test('dep-audit passes when audit is clean', () => {
  const workDir = makeTempDir('sd0x-audit-clean-');
  const binDir = setupStubBin();
  const cleanJsonPath = join(workDir, 'clean.json');
  writeFileSync(
    cleanJsonPath,
    '{"metadata":{"vulnerabilities":{"critical":0,"high":0,"moderate":0,"low":0}}}'
  );

  const result = runDepAudit(workDir, binDir, [], {
    STUB_AUDIT_JSON: cleanJsonPath,
    STUB_AUDIT_EXIT: '0',
  });
  assert.equal(result.status, 0);
});

test('dep-audit --help exits 0 and shows usage', () => {
  const workDir = makeTempDir('sd0x-audit-help-');
  const binDir = setupStubBin();

  const result = runDepAudit(workDir, binDir, ['--help'], {});
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('dep-audit unknown arg exits 2', () => {
  const workDir = makeTempDir('sd0x-audit-unknown-');
  const binDir = setupStubBin();

  const result = runDepAudit(workDir, binDir, ['--nope'], {});
  assert.equal(result.status, 2);
});

test('dep-audit --level high ignores moderate-only findings', () => {
  const workDir = makeTempDir('sd0x-audit-high-');
  const binDir = setupStubBin();
  const vulnJsonPath = join(workDir, 'vuln.json');
  writeFileSync(
    vulnJsonPath,
    '{"metadata":{"vulnerabilities":{"critical":0,"high":0,"moderate":3,"low":0}}}'
  );

  const result = runDepAudit(workDir, binDir, ['--level', 'high'], {
    STUB_AUDIT_JSON: vulnJsonPath,
    STUB_AUDIT_EXIT: '0',
  });
  assert.equal(result.status, 0);
});

test('dep-audit with failing jq defaults to zero counts', () => {
  const workDir = makeTempDir('sd0x-audit-no-jq-');
  const binDir = setupStubBin({ includeJq: false, includeCoreUtils: true });
  const vulnJsonPath = join(workDir, 'vuln.json');
  writeFileSync(
    vulnJsonPath,
    '{"metadata":{"vulnerabilities":{"critical":1,"high":2,"moderate":3,"low":4}}}'
  );

  // Shadow system jq with a stub that always fails,
  // triggering the || echo "0" fallback in dep-audit.sh
  writeExecutable(join(binDir, 'jq'), '#!/bin/sh\nexit 1\n');

  const result = runDepAudit(workDir, binDir, [], {
    STUB_AUDIT_JSON: vulnJsonPath,
    STUB_AUDIT_EXIT: '1',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\| High \| 0 \|/);
});
