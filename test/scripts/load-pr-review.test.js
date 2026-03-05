const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  chmodSync,
  rmSync,
  symlinkSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const SCRIPT = resolve(
  __dirname,
  '../../skills/load-pr-review/scripts/load-pr-review.js'
);

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `sd0x-lpr-${prefix}-`));
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

// Sample GraphQL response
const SAMPLE_GQL_RESPONSE = {
  data: {
    repository: {
      pullRequest: {
        title: 'Test PR',
        number: 42,
        url: 'https://github.com/owner/repo/pull/42',
        headRefName: 'feat/test',
        baseRefName: 'main',
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: 'PRRT_a',
              isResolved: false,
              isOutdated: false,
              path: 'src/foo.ts',
              line: 42,
              startLine: null,
              diffSide: 'RIGHT',
              comments: {
                nodes: [
                  {
                    id: 'PRRC_1',
                    databaseId: 1001,
                    body: 'Use early return pattern here',
                    author: { login: 'alice' },
                    createdAt: '2026-03-01T10:00:00Z',
                  },
                ],
              },
            },
            {
              id: 'PRRT_b',
              isResolved: true,
              isOutdated: false,
              path: 'src/bar.ts',
              line: 15,
              startLine: null,
              diffSide: 'RIGHT',
              comments: {
                nodes: [
                  {
                    id: 'PRRC_2',
                    databaseId: 1002,
                    body: 'Already fixed',
                    author: { login: 'bob' },
                    createdAt: '2026-03-01T09:00:00Z',
                  },
                ],
              },
            },
            {
              id: 'PRRT_c',
              isResolved: false,
              isOutdated: true,
              path: 'src/old.ts',
              line: 5,
              startLine: null,
              diffSide: 'LEFT',
              comments: {
                nodes: [
                  {
                    id: 'PRRC_3',
                    databaseId: 1003,
                    body: 'Outdated comment',
                    author: { login: 'carol' },
                    createdAt: '2026-03-01T08:00:00Z',
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
};

const SAMPLE_PR_META = {
  number: 42,
  title: 'Test PR',
  url: 'https://github.com/owner/repo/pull/42',
  headRefName: 'feat/test',
  baseRefName: 'main',
  state: 'OPEN',
  reviewDecision: 'CHANGES_REQUESTED',
};

// Sample REST response
const SAMPLE_REST_COMMENTS = [
  {
    id: 2001,
    path: 'src/foo.ts',
    position: 10,
    original_position: 10,
    original_line: 42,
    line: 42,
    side: 'RIGHT',
    body: 'REST comment 1',
    user: { login: 'alice' },
    created_at: '2026-03-01T10:00:00Z',
  },
  {
    id: 2002,
    path: 'src/foo.ts',
    position: 10,
    original_position: 10,
    original_line: 42,
    line: 42,
    side: 'RIGHT',
    body: 'REST reply',
    user: { login: 'bob' },
    created_at: '2026-03-01T11:00:00Z',
  },
  {
    id: 2003,
    path: 'src/bar.ts',
    position: null,
    original_position: 5,
    original_line: 15,
    line: null,
    side: 'RIGHT',
    body: 'Outdated REST comment',
    user: { login: 'carol' },
    created_at: '2026-03-01T08:00:00Z',
  },
];

/**
 * Create stub gh binary that responds based on args.
 */
function setupStubBin(options = {}) {
  const {
    gqlResponse = SAMPLE_GQL_RESPONSE,
    gqlExitCode = 0,
    restResponse = SAMPLE_REST_COMMENTS,
    restExitCode = 0,
    prMeta = SAMPLE_PR_META,
    prMetaExitCode = 0,
    replyExitCode = 0,
    resolveExitCode = 0,
    jqExitCode = 0,
    metaRaw = null,
    repoViewExitCode = 0,
  } = options;

  const binDir = makeTempDir('bin');

  // Write response files for the stub to cat
  const dataDir = makeTempDir('data');
  writeFileSync(join(dataDir, 'gql.json'), JSON.stringify(gqlResponse));
  writeFileSync(join(dataDir, 'rest.json'), JSON.stringify(restResponse));
  writeFileSync(join(dataDir, 'meta.json'), metaRaw !== null ? metaRaw : JSON.stringify(prMeta));

  const stubGh = `#!/bin/sh
# Trace for debugging
if [ -n "\${GH_TRACE_FILE:-}" ]; then
  echo "$*" >> "\$GH_TRACE_FILE"
fi

case "$1" in
  pr)
    case "$2" in
      view)
        if [ "${prMetaExitCode}" != "0" ]; then exit ${prMetaExitCode}; fi
        cat "${join(dataDir, 'meta.json')}"
        exit 0
        ;;
    esac
    ;;
  repo)
    if [ "${repoViewExitCode}" != "0" ]; then exit ${repoViewExitCode}; fi
    echo "owner/repo"
    exit 0
    ;;
  api)
    case "$2" in
      graphql)
        # Route resolve mutation before generic GraphQL handler
        if echo "$*" | grep -q "resolveReviewThread"; then
          if [ "${resolveExitCode}" != "0" ]; then
            echo "Resolve error" >&2
            exit ${resolveExitCode}
          fi
          echo '{"data":{"resolveReviewThread":{"thread":{"isResolved":true}}}}'
          exit 0
        fi
        if [ "${gqlExitCode}" != "0" ]; then
          echo "GraphQL error" >&2
          exit ${gqlExitCode}
        fi
        cat "${join(dataDir, 'gql.json')}"
        exit 0
        ;;
      --method)
        # writeback POST — find --input <file> arg and verify it exists
        INPUT_FILE=""
        shift; shift; shift; shift  # skip --method POST repos/.../replies
        while [ $# -gt 0 ]; do
          case "$1" in
            --input) INPUT_FILE="$2"; shift 2 ;;
            *) shift ;;
          esac
        done
        if [ -n "$INPUT_FILE" ] && [ -f "$INPUT_FILE" ]; then
          : # input file exists, good
        fi
        if [ "${replyExitCode}" != "0" ]; then
          echo "Reply error" >&2
          exit ${replyExitCode}
        fi
        echo '{"id": 9999}'
        exit 0
        ;;
      repos/*)
        # REST fallback
        if [ "${restExitCode}" != "0" ]; then
          echo "REST error" >&2
          exit ${restExitCode}
        fi
        cat "${join(dataDir, 'rest.json')}"
        exit 0
        ;;
    esac
    echo "Unknown gh api call: $*" >&2
    exit 1
    ;;
esac
echo "Unknown gh command: $*" >&2
exit 1
`;

  writeExecutable(join(binDir, 'gh'), stubGh);

  // Stub jq
  const stubJq = `#!/bin/sh
if [ "${jqExitCode}" != "0" ]; then
  echo "jq error" >&2
  exit ${jqExitCode}
fi
# Simple jq stub — for -n --arg body <val> '{body:$body}'
# Just pass through the body as JSON
BODY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --arg)
      shift; shift; BODY="$1"; shift ;;
    *) shift ;;
  esac
done
printf '{"body":"%s"}' "$BODY"
`;
  writeExecutable(join(binDir, 'jq'), stubJq);

  // Link system essentials
  for (const cmd of ['bash', 'node', 'cat', 'grep', 'printf', 'echo']) {
    linkSystemCommand(binDir, cmd);
  }

  return binDir;
}

function runScript(args, binDir, envOverrides = {}) {
  // Find real node binary for execution
  const nodeResult = spawnSync('which', ['node'], { encoding: 'utf8' });
  const nodeBin = nodeResult.stdout.trim();

  const env = {
    PATH: `${binDir}:/usr/bin:/bin`,
    HOME: makeTempDir('home'),
    ...envOverrides,
  };
  const result = spawnSync(nodeBin, [SCRIPT, ...args], {
    encoding: 'utf8',
    env,
    timeout: 30000,
  });
  return result;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// fetch subcommand tests
// ============================================================

test('fetch: GraphQL happy path', () => {
  const binDir = setupStubBin();
  const result = runScript(['fetch', '--pr', '42', '--repo', 'owner/repo'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.pr.number, 42);
  assert.equal(data.pr.title, 'Test PR');
  // Default: unresolved + not outdated only = 1 thread (PRRT_a)
  assert.equal(data.threads.length, 1);
  assert.equal(data.threads[0].id, 'PRRT_a');
  assert.equal(data.summary.total, 3);
  assert.equal(data.summary.loaded, 1);
});

test('fetch: REST fallback when GraphQL fails', () => {
  const binDir = setupStubBin({ gqlExitCode: 1 });
  const result = runScript(['fetch', '--pr', '42', '--repo', 'owner/repo'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.summary.degraded, true);
  // REST groups by path+position, so 2 groups (foo:10 and bar:5)
  assert.ok(data.threads.length >= 1);
});

test('fetch: PR not found', () => {
  const binDir = setupStubBin({ prMetaExitCode: 1 });
  const result = runScript(['fetch', '--pr', '999', '--repo', 'owner/repo'], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/i);
});

test('fetch: --all includes resolved threads', () => {
  const binDir = setupStubBin();
  const result = runScript(['fetch', '--pr', '42', '--repo', 'owner/repo', '--all'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  // --all: includes resolved + outdated = all 3 threads
  assert.equal(data.threads.length, 3);
});

test('fetch: --budget truncation', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--pr', '42', '--repo', 'owner/repo', '--all', '--budget', '2',
  ], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.threads.length, 2);
  assert.equal(data.summary.truncated, 1);
});

test('fetch: empty threads (no reviews)', () => {
  const emptyGql = JSON.parse(JSON.stringify(SAMPLE_GQL_RESPONSE));
  emptyGql.data.repository.pullRequest.reviewThreads.nodes = [];
  const binDir = setupStubBin({ gqlResponse: emptyGql });
  const result = runScript(['fetch', '--pr', '42', '--repo', 'owner/repo'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.threads.length, 0);
  assert.equal(data.summary.total, 0);
});

test('fetch: --markdown output', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--pr', '42', '--repo', 'owner/repo', '--markdown',
  ], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /## PR #42/);
  assert.match(result.stdout, /src\/foo\.ts/);
});

test('fetch: URL parsing', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--url', 'https://github.com/owner/repo/pull/42',
  ], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.pr.number, 42);
});

// ============================================================
// digest subcommand tests
// ============================================================

test('digest: within budget', () => {
  const inputDir = makeTempDir('input');
  const inputPath = join(inputDir, 'data.json');
  const inputData = {
    pr: { number: 42, title: 'Test', url: 'https://example.com', head: 'feat/x', base: 'main' },
    summary: { total: 2, unresolved: 2, outdated: 0, loaded: 2, truncated: 0, degraded: false },
    threads: [
      { id: 'T1', path: 'a.ts', line: 1, isResolved: false, isOutdated: false, comments: [{ id: 'C1', databaseId: 1, author: 'alice', body: 'Fix this', createdAt: '2026-03-01T10:00:00Z' }] },
      { id: 'T2', path: 'b.ts', line: 2, isResolved: false, isOutdated: false, comments: [{ id: 'C2', databaseId: 2, author: 'bob', body: 'Fix that', createdAt: '2026-03-01T09:00:00Z' }] },
    ],
  };
  writeFileSync(inputPath, JSON.stringify(inputData));

  const binDir = setupStubBin();
  const result = runScript(['digest', '--input', inputPath, '--budget', '30'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.threads.length, 2);
});

test('digest: over budget truncation', () => {
  const inputDir = makeTempDir('input');
  const inputPath = join(inputDir, 'data.json');
  const inputData = {
    pr: { number: 42, title: 'Test', url: 'https://example.com', head: 'feat/x', base: 'main' },
    summary: { total: 3, unresolved: 3, outdated: 0, loaded: 3, truncated: 0, degraded: false },
    threads: [
      { id: 'T1', path: 'a.ts', line: 1, isResolved: false, isOutdated: false, comments: [{ id: 'C1', databaseId: 1, author: 'a', body: 'x', createdAt: '2026-03-03T10:00:00Z' }] },
      { id: 'T2', path: 'b.ts', line: 2, isResolved: false, isOutdated: false, comments: [{ id: 'C2', databaseId: 2, author: 'b', body: 'y', createdAt: '2026-03-02T10:00:00Z' }] },
      { id: 'T3', path: 'c.ts', line: 3, isResolved: false, isOutdated: false, comments: [{ id: 'C3', databaseId: 3, author: 'c', body: 'z', createdAt: '2026-03-01T10:00:00Z' }] },
    ],
  };
  writeFileSync(inputPath, JSON.stringify(inputData));

  const binDir = setupStubBin();
  const result = runScript(['digest', '--input', inputPath, '--budget', '2'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.threads.length, 2);
  assert.equal(data.summary.truncated, 1);
});

test('digest: missing input file', () => {
  const binDir = setupStubBin();
  const result = runScript(['digest', '--input', '/nonexistent/file.json'], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not found/i);
});

// ============================================================
// writeback subcommand tests
// ============================================================

test('writeback: --plan output', () => {
  const inputDir = makeTempDir('input');
  const inputPath = join(inputDir, 'data.json');
  const inputData = {
    threads: [
      { id: 'PRRT_a', path: 'src/foo.ts', line: 42, replyTargetId: 1001, isResolved: false, isOutdated: false, comments: [] },
      { id: 'PRRT_b', path: 'src/bar.ts', line: 15, replyTargetId: 1002, isResolved: false, isOutdated: false, comments: [] },
    ],
  };
  writeFileSync(inputPath, JSON.stringify(inputData));

  const binDir = setupStubBin();
  const result = runScript([
    'writeback', '--plan', '--input', inputPath, '--threads', 'PRRT_a,PRRT_b',
  ], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /Writeback Plan/);
  assert.match(result.stdout, /PRRT_a/);
  assert.match(result.stdout, /PRRT_b/);
});

test('writeback: --plan missing thread warns', () => {
  const inputDir = makeTempDir('input');
  const inputPath = join(inputDir, 'data.json');
  const inputData = {
    threads: [
      { id: 'PRRT_a', path: 'src/foo.ts', line: 42, replyTargetId: 1001, isResolved: false, isOutdated: false, comments: [] },
    ],
  };
  writeFileSync(inputPath, JSON.stringify(inputData));

  const binDir = setupStubBin();
  const result = runScript([
    'writeback', '--plan', '--input', inputPath, '--threads', 'PRRT_nonexistent',
  ], binDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No matching/i);
});

test('writeback: --execute success', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'writeback', '--execute',
    '--thread', 'PRRT_a',
    '--reply', 'Fixed in abc123',
    '--replyTargetId', '1001',
    '--repo', 'owner/repo',
    '--pr', '42',
  ], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /Reply posted/);
});

test('writeback: --execute no replyTargetId', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'writeback', '--execute',
    '--thread', 'PRRT_a',
    '--reply', 'Fixed',
    '--repo', 'owner/repo',
    '--pr', '42',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /replyTargetId/i);
});

// ============================================================
// edge case tests
// ============================================================

test('edge: no subcommand', () => {
  const binDir = setupStubBin();
  const result = runScript([], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown subcommand/i);
});

test('edge: invalid subcommand', () => {
  const binDir = setupStubBin();
  const result = runScript(['invalidcmd'], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown subcommand/i);
});

test('edge: invalid --budget (negative)', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--pr', '42', '--repo', 'owner/repo', '--budget', '-5',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /budget/i);
});

test('edge: invalid --budget (NaN)', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--pr', '42', '--repo', 'owner/repo', '--budget', 'abc',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /budget/i);
});

test('fetch: --pr without --repo infers repo', () => {
  const binDir = setupStubBin();
  // stub gh repo view already returns "owner/repo"
  const result = runScript(['fetch', '--pr', '42'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.pr.number, 42);
});

test('digest: invalid --budget (negative)', () => {
  const inputDir = makeTempDir('input');
  const inputPath = join(inputDir, 'data.json');
  const inputData = {
    pr: { number: 42, title: 'Test', url: 'https://example.com', head: 'feat/x', base: 'main' },
    summary: { total: 1, unresolved: 1, outdated: 0, loaded: 1, truncated: 0, degraded: false },
    threads: [
      { id: 'T1', path: 'a.ts', line: 1, isResolved: false, isOutdated: false, comments: [{ id: 'C1', databaseId: 1, author: 'a', body: 'x', createdAt: '2026-03-01T10:00:00Z' }] },
    ],
  };
  writeFileSync(inputPath, JSON.stringify(inputData));

  const binDir = setupStubBin();
  const result = runScript(['digest', '--input', inputPath, '--budget', '-3'], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /budget/i);
});

test('edge: non-numeric --replyTargetId', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'writeback', '--execute',
    '--thread', 'PRRT_a',
    '--reply', 'Fixed',
    '--replyTargetId', 'not-a-number',
    '--repo', 'owner/repo',
    '--pr', '42',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /numeric/i);
});

// ============================================================
// Writeback failure tests (W1-W3)
// ============================================================

test('W1: writeback --execute jq failure exits 2', () => {
  const binDir = setupStubBin({ jqExitCode: 1 });
  const result = runScript([
    'writeback', '--execute',
    '--thread', 'PRRT_a',
    '--reply', 'Fixed in abc123',
    '--replyTargetId', '1001',
    '--repo', 'owner/repo',
    '--pr', '42',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /jq failed/i);
});

test('W2: writeback --execute reply POST failure exits 1', () => {
  const binDir = setupStubBin({ replyExitCode: 1 });
  const result = runScript([
    'writeback', '--execute',
    '--thread', 'PRRT_a',
    '--reply', 'Fixed in abc123',
    '--replyTargetId', '1001',
    '--repo', 'owner/repo',
    '--pr', '42',
  ], binDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reply failed/i);
});

test('W3: writeback --execute resolve failure exits 1', () => {
  const binDir = setupStubBin({ resolveExitCode: 1 });
  const result = runScript([
    'writeback', '--execute',
    '--thread', 'PRRT_a',
    '--reply', 'Fixed in abc123',
    '--replyTargetId', '1001',
    '--repo', 'owner/repo',
    '--pr', '42',
    '--resolve',
  ], binDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /resolve failed/i);
});

// ============================================================
// Fetch error path tests (F1-F3)
// ============================================================

test('F1: PR metadata parse failure exits 2', () => {
  const binDir = setupStubBin({ metaRaw: 'not-valid-json{{{' });
  const result = runScript(['fetch', '--pr', '42', '--repo', 'owner/repo'], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /parse.*metadata/i);
});

test('F2: GraphQL + REST both fail exits 2', () => {
  const binDir = setupStubBin({ gqlExitCode: 1, restExitCode: 1 });
  const result = runScript(['fetch', '--pr', '42', '--repo', 'owner/repo'], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /failed to fetch/i);
});

test('F3: --pr without --repo and repo view fails exits 2', () => {
  const binDir = setupStubBin({ repoViewExitCode: 1 });
  const result = runScript(['fetch', '--pr', '42'], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--pr requires --repo/i);
});

// ============================================================
// Budget boundary tests (B1-B3)
// ============================================================

test('B1: budget=0 exits 2', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--pr', '42', '--repo', 'owner/repo', '--budget', '0',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /budget/i);
});

test('B2: budget=201 (exceeds ALL_BUDGET) exits 2', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--pr', '42', '--repo', 'owner/repo', '--budget', '201',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /budget/i);
});

test('B3: budget=1 loads exactly 1 thread', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--pr', '42', '--repo', 'owner/repo', '--all', '--budget', '1',
  ], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.threads.length, 1);
  assert.equal(data.summary.truncated, 2);
});

// ============================================================
// Parse error tests (P1-P3)
// ============================================================

test('P1: invalid URL format exits 2', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--url', 'https://not-github.com/invalid/path',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid.*url/i);
});

test('P2: invalid --repo format exits 2', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'fetch', '--pr', '42', '--repo', 'invalid-no-slash',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid.*--repo/i);
});

test('P3: writeback without --plan or --execute exits 2', () => {
  const binDir = setupStubBin();
  const result = runScript(['writeback'], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--plan or --execute/i);
});

// ============================================================
// Normalization tests (N1-N3)
// ============================================================

test('N1: REST fallback sets degraded flag and preserves thread structure', () => {
  const binDir = setupStubBin({ gqlExitCode: 1 });
  const result = runScript(['fetch', '--pr', '42', '--repo', 'owner/repo', '--all'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.summary.degraded, true);
  // Verify threads have expected fields from REST grouping
  for (const t of data.threads) {
    assert.ok(t.id, 'thread should have id');
    assert.ok(typeof t.path === 'string', 'thread should have path');
    assert.ok(Array.isArray(t.comments), 'thread should have comments array');
  }
});

test('N2: threads sorted unresolved+not-outdated first', () => {
  const binDir = setupStubBin();
  const result = runScript(['fetch', '--pr', '42', '--repo', 'owner/repo', '--all'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  // PRRT_a (unresolved, not outdated) should come first
  // PRRT_c (unresolved, outdated) should come before PRRT_b (resolved)
  assert.equal(data.threads[0].id, 'PRRT_a');
  const resolvedIdx = data.threads.findIndex(t => t.id === 'PRRT_b');
  const outdatedIdx = data.threads.findIndex(t => t.id === 'PRRT_c');
  assert.ok(outdatedIdx < resolvedIdx, 'outdated-unresolved should come before resolved');
});

test('N3: replyTargetId equals first comment databaseId', () => {
  const binDir = setupStubBin();
  const result = runScript(['fetch', '--pr', '42', '--repo', 'owner/repo', '--all'], binDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const data = JSON.parse(result.stdout);
  for (const t of data.threads) {
    if (t.comments.length > 0) {
      assert.equal(t.replyTargetId, t.comments[0].databaseId,
        `thread ${t.id}: replyTargetId should equal first comment databaseId`);
    }
  }
});

// ============================================================
// Edge case tests (E1-E3)
// ============================================================

test('E1: writeback --execute missing --reply exits 2', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'writeback', '--execute',
    '--thread', 'PRRT_a',
    '--replyTargetId', '1001',
    '--repo', 'owner/repo',
    '--pr', '42',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--reply.*required/i);
});

test('E2: writeback --execute missing --repo exits 2', () => {
  const binDir = setupStubBin();
  const result = runScript([
    'writeback', '--execute',
    '--thread', 'PRRT_a',
    '--reply', 'Fixed',
    '--replyTargetId', '1001',
    '--pr', '42',
  ], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--repo.*--pr.*required/i);
});

test('E3: digest corrupt input JSON exits 2', () => {
  const inputDir = makeTempDir('input');
  const inputPath = join(inputDir, 'data.json');
  writeFileSync(inputPath, 'this is not json!!!');

  const binDir = setupStubBin();
  const result = runScript(['digest', '--input', inputPath], binDir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /parse.*json/i);
});
