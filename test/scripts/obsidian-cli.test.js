const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  chmodSync,
  rmSync,
  existsSync,
  symlinkSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const execScript = resolve(
  __dirname,
  '../../skills/obsidian-cli/scripts/obsidian-exec.sh'
);
const preflightScript = resolve(
  __dirname,
  '../../skills/obsidian-cli/scripts/obsidian-preflight.sh'
);

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `sd0x-obs-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function linkSystemCommand(binDir, name) {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  if (result.status !== 0) return false;
  const target = result.stdout.trim();
  if (!target) return false;
  try {
    symlinkSync(target, join(binDir, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a stub bin dir with a fake obsidian CLI and required system commands.
 * The stub obsidian prints version/vault/search output as configured.
 */
function setupStubBin(options = {}) {
  const {
    obsidianVersion = '1.12.0',
    obsidianVault = 'TestVault',
    obsidianExitCode = 0,
    includeObsidian = true,
    includeTimeout = true,
  } = options;
  const binDir = makeTempDir('bin');

  // Stub obsidian binary — logs all args to OBSIDIAN_TRACE_FILE if set
  // Obsidian CLI uses key=value syntax: obsidian <command> vault="name" key=value
  if (includeObsidian) {
    const stubObsidian = `#!/bin/sh
# Trace args for test verification
if [ -n "\${OBSIDIAN_TRACE_FILE:-}" ]; then
  echo "$*" >> "\$OBSIDIAN_TRACE_FILE"
fi
# Extract command (first arg) — vault=<name> is a key=value option, not a flag
CMD="$1"; shift
case "\$CMD" in
  version) echo "${obsidianVersion}"; exit ${obsidianExitCode} ;;
  vault)   echo "${obsidianVault}"; exit 0 ;;
  search)  echo "Search results for: $*"; exit 0 ;;
  read)    if [ "\${STUB_READ_NOT_FOUND:-}" = "1" ]; then echo 'Error: File "test.md" not found.'; elif [ -n "\${STUB_READ_ERROR:-}" ]; then echo "Error: \${STUB_READ_ERROR}"; elif [ -n "\${STUB_READ_CONTENT:-}" ]; then echo "\${STUB_READ_CONTENT}"; fi; exit 0 ;;
  append)  if [ -n "\${STUB_APPEND_ERROR:-}" ]; then echo "Error: \${STUB_APPEND_ERROR}"; else echo "Appended"; fi; exit 0 ;;
  create)  if [ -n "\${STUB_CREATE_ERROR:-}" ]; then echo "Error: \${STUB_CREATE_ERROR}"; else echo "Created"; fi; exit 0 ;;
  daily:append) echo "Daily appended"; exit 0 ;;
  tasks)        echo "- [ ] Task 1"; exit 0 ;;
  *)            echo "Unknown command: \$CMD"; exit 1 ;;
esac
`;
    writeExecutable(join(binDir, 'obsidian'), stubObsidian);
  }

  // Stub timeout — delegates to real command or creates a basic shim
  if (includeTimeout) {
    const stubTimeout = `#!/bin/sh
shift  # skip timeout seconds
exec "$@"
`;
    writeExecutable(join(binDir, 'timeout'), stubTimeout);
  }

  // Link system essentials
  for (const cmd of ['bash', 'grep', 'sed', 'head', 'cat', 'mkdir', 'printf', 'perl']) {
    linkSystemCommand(binDir, cmd);
  }

  return binDir;
}

/**
 * Run a script with controlled PATH and HOME.
 */
function runScript(script, args, binDir, envOverrides = {}) {
  const home = makeTempDir('home');
  const env = {
    PATH: `${binDir}:/usr/bin:/bin`,
    HOME: home,
    ...envOverrides,
  };
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env,
    timeout: 10000,
  });
  return { ...result, home };
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// obsidian-exec.sh tests
// ============================================================

test('exec: no args exits non-zero with usage', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, [], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test('exec: unknown intent exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['bogus'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown intent/);
});

test('exec: context without --query exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['context'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--query is required/);
});

test('exec: context --query without value exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['context', '--query'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--query requires a value/);
});

test('exec: context --limit without value exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['context', '--query', 'test', '--limit'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--limit requires a value/);
});

test('exec: context with unknown arg exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['context', '--query', 'test', '--bad'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown arg/);
});

test('exec: context --query succeeds with stub obsidian', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['context', '--query', 'auth'], binDir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Search results/);
});

test('exec: capture without --file exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['capture', '--text', 'hello'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--file is required/);
});

test('exec: capture without --text exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['capture', '--file', 'notes.md'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--text is required/);
});

test('exec: capture with both args succeeds', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, [
    'capture', '--file', 'notes.md', '--text', 'hello world',
  ], binDir);
  assert.equal(result.status, 0);
});

test('exec: daily without --text exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['daily'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--text is required/);
});

test('exec: daily --text succeeds', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['daily', '--text', 'session note'], binDir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Daily appended/);
});

test('exec: task without action exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['task'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /specify --add or --list/);
});

test('exec: task --add without text exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['task', '--add'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--add requires text/);
});

test('exec: task --add succeeds', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['task', '--add', 'Review PR'], binDir);
  assert.equal(result.status, 0);
});

test('exec: task --list succeeds', () => {
  const binDir = setupStubBin();
  const result = runScript(execScript, ['task', '--list'], binDir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Task 1/);
});

test('exec: resolves vault from OBSIDIAN_VAULT env and passes vault= option', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');
  const traceFile = join(home, 'trace.log');

  const result = spawnSync('bash', [execScript, 'context', '--query', 'test'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      OBSIDIAN_VAULT: 'EnvVault',
      OBSIDIAN_TRACE_FILE: traceFile,
    },
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  // Verify vault=EnvVault was passed (key=value syntax, not --vault flag)
  const trace = readFileSync(traceFile, 'utf8');
  assert.match(trace, /vault=EnvVault/);
});

test('exec: resolves vault from config file and passes vault= option', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');
  const configDir = join(home, '.sd0x');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'obsidian-cli.env'), 'OBSIDIAN_VAULT=ConfigVault\n');
  const traceFile = join(home, 'trace.log');

  const result = spawnSync('bash', [execScript, 'context', '--query', 'test'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      OBSIDIAN_TRACE_FILE: traceFile,
    },
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  // Verify vault=ConfigVault was passed (key=value syntax)
  const trace = readFileSync(traceFile, 'utf8');
  assert.match(trace, /vault=ConfigVault/);
});

// ============================================================
// obsidian-exec.sh: timeout handling
// ============================================================

test('exec: timeout (rc=124) produces timeout error message', () => {
  const binDir = setupStubBin({ includeTimeout: false });
  // Create a timeout stub that always exits 124
  writeExecutable(join(binDir, 'timeout'), '#!/bin/sh\nexit 124\n');

  const result = runScript(execScript, ['context', '--query', 'test'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /timed out/);
});

// ============================================================
// obsidian-exec.sh: missing CLI
// ============================================================

test('exec: missing obsidian CLI exits non-zero', { skip: existsSync('/Applications/Obsidian.app/Contents/MacOS/obsidian') ? 'Real Obsidian installed — fallback finds it' : false }, () => {
  const binDir = setupStubBin({ includeObsidian: false });
  const result = runScript(execScript, ['context', '--query', 'test'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Obsidian CLI not found/);
});

// ============================================================
// obsidian-preflight.sh tests
// ============================================================

test('preflight: --check succeeds with stub obsidian', () => {
  const binDir = setupStubBin();
  const result = runScript(preflightScript, ['--check'], binDir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /STATUS=ok/);
  assert.match(result.stdout, /VAULT=/);
  assert.match(result.stdout, /OBSIDIAN_VERSION=1\.12\.0/);
});

test('preflight: no args defaults to --check', () => {
  const binDir = setupStubBin();
  const result = runScript(preflightScript, [], binDir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /STATUS=ok/);
});

test('preflight: unknown option exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(preflightScript, ['--bogus'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option/);
});

test('preflight: --vault without name exits non-zero', () => {
  const binDir = setupStubBin();
  const result = runScript(preflightScript, ['--vault'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--vault requires a name/);
});

test('preflight: --vault persists config and verifies', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');

  const result = spawnSync('bash', [preflightScript, '--vault', 'MyVault'], {
    encoding: 'utf8',
    env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: home },
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Vault persisted: MyVault/);
  assert.match(result.stdout, /STATUS=ok/);

  // Verify config file was created
  const configFile = join(home, '.sd0x', 'obsidian-cli.env');
  assert.ok(existsSync(configFile), 'config file should exist');
  const content = readFileSync(configFile, 'utf8');
  assert.match(content, /OBSIDIAN_VAULT=MyVault/);
});

test('preflight: config round-trip — vault persisted then read back', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');
  const env = { PATH: `${binDir}:/usr/bin:/bin`, HOME: home };

  // Step 1: Set vault
  spawnSync('bash', [preflightScript, '--vault', 'RoundTrip'], {
    encoding: 'utf8',
    env,
    timeout: 10000,
  });

  // Step 2: Print env should show the persisted vault
  const result = spawnSync('bash', [preflightScript, '--print-env'], {
    encoding: 'utf8',
    env,
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /OBSIDIAN_VAULT=RoundTrip/);
});

test('preflight: --print-env without config shows no config', () => {
  const binDir = setupStubBin();
  const result = runScript(preflightScript, ['--print-env'], binDir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /no config file/);
});

test('preflight: missing obsidian CLI exits non-zero', { skip: existsSync('/Applications/Obsidian.app/Contents/MacOS/obsidian') ? 'Real Obsidian installed — fallback finds it' : false }, () => {
  const binDir = setupStubBin({ includeObsidian: false });
  const result = runScript(preflightScript, ['--check'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /STATUS=error/);
});

test('preflight: vault resolution precedence — explicit arg wins over env', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');

  const result = spawnSync('bash', [preflightScript, '--vault', 'ExplicitVault'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      OBSIDIAN_VAULT: 'EnvVault',
    },
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  // The persisted vault should be ExplicitVault
  const configFile = join(home, '.sd0x', 'obsidian-cli.env');
  const content = readFileSync(configFile, 'utf8');
  assert.match(content, /OBSIDIAN_VAULT=ExplicitVault/);
});

test('preflight: vault resolution — env var used when no explicit arg', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');

  const result = spawnSync('bash', [preflightScript, '--check'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      OBSIDIAN_VAULT: 'EnvVault',
    },
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /VAULT=EnvVault/);
});

test('preflight: vault resolution — config file used when no env', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');
  const configDir = join(home, '.sd0x');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'obsidian-cli.env'), 'OBSIDIAN_VAULT=ConfigVault\n');

  const result = spawnSync('bash', [preflightScript, '--check'], {
    encoding: 'utf8',
    env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: home },
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /VAULT=ConfigVault/);
});

test('preflight: timeout (rc=124) produces timeout error', () => {
  const binDir = setupStubBin({ includeTimeout: false });
  // Stub timeout to always exit 124
  writeExecutable(join(binDir, 'timeout'), '#!/bin/sh\nexit 124\n');

  const result = runScript(preflightScript, ['--check'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /timed out/);
});

test('preflight: empty version output produces diagnostic error', () => {
  const binDir = setupStubBin();
  // Override obsidian stub to return empty version
  writeExecutable(join(binDir, 'obsidian'), '#!/bin/sh\ncase "$1" in\n  version) echo ""; exit 0 ;;\n  vault) echo "V"; exit 0 ;;\n  *) exit 1 ;;\nesac\n');

  const result = runScript(preflightScript, ['--check'], binDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /returned no version/);
});

// ============================================================
// Timeout selection paths
// ============================================================

test('exec: uses perl fallback when no timeout/gtimeout in PATH', () => {
  const binDir = setupStubBin({ includeTimeout: false });
  // Ensure timeout/gtimeout are NOT in PATH — only use binDir (no /usr/bin)
  // Link only perl and essential utils
  const perlPath = spawnSync('which', ['perl'], { encoding: 'utf8' });
  if (perlPath.status !== 0) {
    // No perl available, skip
    return;
  }

  const home = makeTempDir('home');
  const result = spawnSync('bash', [execScript, 'context', '--query', 'test'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}`,
      HOME: home,
    },
    timeout: 10000,
  });
  // Should succeed via perl fallback (not "No timeout command found")
  if (result.status !== 0) {
    assert.doesNotMatch(
      result.stderr,
      /No timeout command found/,
      'should use perl fallback, not fail on missing timeout'
    );
  }
});

test('exec: capture uses create when read returns error (file does not exist)', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');
  const traceFile = join(home, 'trace.log');

  const result = spawnSync('bash', [execScript, 'capture', '--file', 'new.md', '--text', 'content'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      STUB_READ_NOT_FOUND: '1',
      OBSIDIAN_TRACE_FILE: traceFile,
    },
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Created/);
  // Verify exact command sequence: read then create (not append)
  const traceLines = readFileSync(traceFile, 'utf8').trim().split('\n');
  assert.equal(traceLines.length, 2, 'expect exactly 2 CLI calls');
  assert.match(traceLines[0], /^read /);
  assert.match(traceLines[1], /^create /);
});

test('exec: capture uses append when read succeeds (file exists)', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');
  const traceFile = join(home, 'trace.log');

  const result = spawnSync('bash', [execScript, 'capture', '--file', 'existing.md', '--text', 'more'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      OBSIDIAN_TRACE_FILE: traceFile,
      // STUB_READ_NOT_FOUND not set — read returns success (no Error: in output)
    },
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Appended/);
  // Verify exact command sequence: read then append (not create)
  const traceLines = readFileSync(traceFile, 'utf8').trim().split('\n');
  assert.equal(traceLines.length, 2, 'expect exactly 2 CLI calls');
  assert.match(traceLines[0], /^read /);
  assert.match(traceLines[1], /^append /);
});

test('exec: capture uses append when multi-line content contains Error: (not a CLI error)', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');

  const result = spawnSync('bash', [execScript, 'capture', '--file', 'errors.md', '--text', 'more'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      // Multi-line file content — CLI diagnostics are single-line, so multi-line = file content
      STUB_READ_CONTENT: 'Error: something went wrong in production\nSecond line of the note',
    },
    timeout: 10000,
  });
  assert.equal(result.status, 0);
  // Should append (multi-line = file exists), not create
  assert.match(result.stdout, /Appended/);
});

test('exec: capture fails fast when append returns CLI error', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');

  const result = spawnSync('bash', [execScript, 'capture', '--file', 'test.md', '--text', 'content'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      // File exists (read returns empty), but append fails with CLI error
      STUB_APPEND_ERROR: 'Vault not found',
    },
    timeout: 10000,
  });
  // Should fail (die) — not silently succeed
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /capture:/);
});

test('exec: capture fails fast when create returns CLI error', () => {
  const binDir = setupStubBin();
  const home = makeTempDir('home');

  const result = spawnSync('bash', [execScript, 'capture', '--file', 'new.md', '--text', 'content'], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      STUB_READ_NOT_FOUND: '1',
      STUB_CREATE_ERROR: 'Permission denied',
    },
    timeout: 10000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /capture:/);
});
