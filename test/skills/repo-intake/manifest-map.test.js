'use strict';
// Tests for skills/repo-intake/scripts/manifest_map.js against the frozen
// contracts in docs/features/repo-intake-manifest-map/2-tech-spec.md (v11).
// Fixtures are generated at runtime in tmpdirs so this repo's own manifest
// corpus never contains fixture manifests.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'skills', 'repo-intake', 'scripts', 'manifest_map.js');
const mm = require(SCRIPT);

const tmpDirs = [];
function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmap-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function runMap(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
}

function mapJson(cwd, args = []) {
  const r = runMap(cwd, ['--format', 'json', ...args]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------
// Unit: node version-spec lexical grammar (frozen EBNF, §3.6)
// ---------------------------------------------------------------------------
describe('matchesRangeGrammar', () => {
  test('accepts frozen range subset → true', () => {
    assert.equal(mm.matchesRangeGrammar('^1.2.3'), true);
    assert.equal(mm.matchesRangeGrammar('~0.1'), true);
    assert.equal(mm.matchesRangeGrammar('>=1.0.0 <2.0.0'), true);
    assert.equal(mm.matchesRangeGrammar('1.2.3 - 2.0.0'), true);
    assert.equal(mm.matchesRangeGrammar('1.x'), true);
    assert.equal(mm.matchesRangeGrammar('^1.2.3-beta.1 || >=3.0.0'), true);
  });

  test('rejects non-range forms → false', () => {
    assert.equal(mm.matchesRangeGrammar('latest'), false);
    assert.equal(mm.matchesRangeGrammar('||^1.0.0'), false, 'empty OR segment');
    assert.equal(mm.matchesRangeGrammar(' ^1.0.0'), false, 'leading whitespace');
    assert.equal(mm.matchesRangeGrammar('git+https://example.com/a.git'), false);
  });

  test('post-parse validations reject wildcard/suffix misuse → false', () => {
    assert.equal(mm.matchesRangeGrammar('1.x.2'), false, 'wildcard must be trailing');
    assert.equal(mm.matchesRangeGrammar('1.2-beta'), false, 'suffix needs 3 digit parts');
    assert.equal(mm.matchesRangeGrammar('1.2.x-beta'), false, 'suffix on wildcard part');
    assert.equal(mm.matchesRangeGrammar('^1.2.3-rc.1'), true, 'valid suffix control');
  });
});

describe('classifyNodeSpec', () => {
  test('classifies the five syntax classes + catch-all', () => {
    assert.deepEqual(mm.classifyNodeSpec('file:../pkg-b'), { kind: 'path', path: '../pkg-b' });
    assert.equal(mm.classifyNodeSpec('workspace:^1.0.0').kind, 'workspace-intent');
    assert.deepEqual(mm.classifyNodeSpec('*'), { kind: 'registry', sub: 'star' });
    assert.deepEqual(mm.classifyNodeSpec('^4.17.21'), { kind: 'registry', sub: 'range' });
    assert.deepEqual(mm.classifyNodeSpec('latest'), { kind: 'registry', sub: 'dist-tag' });
    assert.equal(mm.classifyNodeSpec('npm:react@^18').kind, 'unsupported');
    assert.equal(mm.classifyNodeSpec('git+ssh://git@github.com/a/b.git').kind, 'unsupported');
  });
});

describe('extractPyDepName', () => {
  test('extracts and PEP 503-normalizes leading name', () => {
    assert.deepEqual(mm.extractPyDepName('requests>=2.28'), { ok: true, name: 'requests' });
    assert.deepEqual(mm.extractPyDepName('Foo_Bar[extra]==1.0'), { ok: true, name: 'foo-bar' });
    assert.equal(mm.extractPyDepName('pkg @ git+https://example.com/p.git').ok, false);
    assert.equal(mm.extractPyDepName('./local-dir').ok, false);
  });
});

// ---------------------------------------------------------------------------
// Unit: go.mod recognizer (require is the unit; replace retains applicability)
// ---------------------------------------------------------------------------
describe('parseGoFile', () => {
  test('recognizes module/require/replace with old-version and target kind', () => {
    const text = [
      'module example.com/api', '',
      'go 1.22', '',
      'require (', '\texample.com/lib v1.2.0', '\texample.com/old v0.9.0 // indirect', ')',
      'replace example.com/lib => ../lib',
      'replace example.com/old v0.9.0 => example.com/new v2.0.0',
    ].join('\n');
    const r = mm.parseGoFile(text, 'go.mod');
    assert.equal(r.data.module, 'example.com/api');
    assert.equal(r.data.requires.length, 2);
    assert.deepEqual(r.data.replaces.map(x => [x.oldModule, x.oldVersion, x.targetKind]), [
      ['example.com/lib', null, 'path'],
      ['example.com/old', 'v0.9.0', 'module'],
    ]);
    assert.equal(r.data.unsupported.length, 0);
  });

  test('unrecognized directive → unsupported record, not silent drop', () => {
    const r = mm.parseGoFile('module m\nrequire a.b/c v1.0.0\nweird directive here\n', 'go.mod');
    assert.equal(r.data.requires.length, 1);
    assert.equal(r.data.unsupported.length, 1);
    assert.equal(r.data.unsupported[0].line, 3);
  });
});

// ---------------------------------------------------------------------------
// Unit: conservative TOML recognizer (frozen field set, §3.5)
// ---------------------------------------------------------------------------
describe('parseTomlManifest (cargo)', () => {
  test('recognizes package, deps, workspace members and templates', () => {
    const text = [
      '[package]', 'name = "app"', '',
      '[workspace]', 'members = ["crates/util"]', '',
      '[workspace.dependencies]', 'shared = { path = "crates/shared" }', '',
      '[dependencies]', 'serde = "1.0"', 'util = { path = "crates/util", optional = true }',
    ].join('\n');
    const r = mm.parseTomlManifest(text, 'cargo');
    assert.equal(r.data.packageName, 'app');
    assert.deepEqual(r.data.members.map(m => m.value), ['crates/util']);
    assert.equal(r.data.templates[0].name, 'shared');
    assert.deepEqual(r.data.deps.map(d => d.name), ['serde', 'util']);
    assert.equal(r.data.deps[1].fields.optional, true);
    assert.equal(r.unsupported.length, 0);
  });

  test('unknown inline field and dotted key → unsupported, zero deps collected', () => {
    const text = [
      '[package]', 'name = "app"',
      '[dependencies]',
      'gitdep = { git = "https://example.com/r.git" }',
      'serde.workspace = true',
    ].join('\n');
    const r = mm.parseTomlManifest(text, 'cargo');
    assert.equal(r.data.deps.length, 0);
    assert.equal(r.unsupported.length, 2);
    assert.match(r.unsupported[0].construct, /'git'/);
    assert.match(r.unsupported[1].construct, /dotted key/);
  });
});

describe('parsePackageJson', () => {
  test('collects sections with scope mapping; non-string spec → unsupported', () => {
    const text = JSON.stringify({
      name: 'web-app',
      workspaces: ['packages/*'],
      dependencies: { express: '^4.18.0' },
      devDependencies: { vitest: { weird: true } },
      peerDependencies: { react: '>=17' },
    }, null, 2);
    const r = mm.parsePackageJson(text);
    assert.deepEqual(r.data.deps.map(d => [d.name, d.scope]), [
      ['express', 'runtime'], ['react', 'peer'],
    ]);
    assert.equal(r.unsupported.length, 1);
    assert.deepEqual(r.data.workspaces.patterns, ['packages/*']);
  });
});

// ---------------------------------------------------------------------------
// E2E: node monorepo — membership, roles, path / workspace-intent / star edges
// ---------------------------------------------------------------------------
describe('node monorepo E2E', () => {
  let dir;
  before(() => {
    dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'monorepo-root',
        workspaces: ['packages/*'],
        dependencies: { 'pkg-b': '*' },
      }),
      'packages/a/package.json': JSON.stringify({
        name: 'pkg-a',
        dependencies: {
          'pkg-b': 'file:../b',
          lodash: '^4.17.21',
          'pkg-x': 'workspace:^1.0.0',
        },
      }),
      'packages/b/package.json': JSON.stringify({ name: 'pkg-b' }),
    });
  });

  test('roles: root standalone, members confirmed via controller', () => {
    const env = mapJson(dir);
    const roles = Object.fromEntries(env.artifact.workspaces.map(w => [w.id, w.role]));
    assert.equal(roles['ws:node:.'], 'standalone_root');
    assert.equal(roles['ws:node:packages/a'], 'confirmed_workspace');
    assert.equal(roles['ws:node:packages/b'], 'confirmed_workspace');
    const ctl = env.artifact.controllers.find(c => c.id === 'ctl:node_workspaces:.');
    assert.deepEqual(ctl.members, ['ws:node:packages/a', 'ws:node:packages/b']);
    assert.equal(ctl.membershipStatus, 'parsed');
  });

  test('path edge local, star + unique arch match local, registry miss external', () => {
    const env = mapJson(dir);
    const key = e => `${e.from}→${e.to}:${e.resolution}`;
    const keys = env.artifact.edges.map(key);
    assert.ok(keys.includes('ws:node:packages/a→ws:node:packages/b:local'), 'file: path edge');
    assert.ok(keys.includes('ws:node:.→ws:node:packages/b:local'), 'star with unique arch match');
    assert.ok(keys.includes('ws:node:packages/a→ext:node:lodash:external'));
    assert.ok(env.artifact.edges.every(e => e.relation === 'declares_dependency'));
  });

  test('workspace-intent with no member → missing_workspace_member unresolved', () => {
    const env = mapJson(dir);
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'pkg-x');
    assert.equal(u.reason, 'missing_workspace_member');
    assert.equal(u.from, 'ws:node:packages/a');
    assert.deepEqual(u.candidates, []);
  });

  test('invariant: membership declaration alone creates no edge', () => {
    const env = mapJson(dir);
    const fromRoot = env.artifact.edges.filter(e => e.from === 'ws:node:.');
    assert.deepEqual(fromRoot.map(e => e.to), ['ws:node:packages/b'],
      'pkg-a is a member but never declared as a dependency of root');
  });

  test('reverse query lists direct dependents only', () => {
    const env = mapJson(dir, ['--reverse', 'pkg-b']);
    assert.equal(env.query.kind, 'reverse');
    assert.equal(env.query.selector, 'ws:node:packages/b');
    assert.deepEqual(env.query.results.map(e => e.from),
      ['ws:node:.', 'ws:node:packages/a'], 'contractual from-ordering, unsorted');
    const rev = mapJson(dir, ['--reverse', 'lodash']);
    assert.deepEqual(rev.query.results.map(e => e.from), ['ws:node:packages/a']);
  });
});

// ---------------------------------------------------------------------------
// E2E: invariants — 同名 ⇏ local；in-corpus 候選存在 ⇏ external（rust 除外）
// ---------------------------------------------------------------------------
describe('same-name candidate invariants', () => {
  test('range dep with candidate shadow → unresolved, no edge, no external', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'app', dependencies: { lodash: '^4.0.0' } }),
      'libs/lodash/package.json': JSON.stringify({ name: 'lodash' }),
    });
    const env = mapJson(dir);
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'lodash');
    assert.equal(u.reason, 'unverified_workspace_match');
    assert.deepEqual(u.candidates, ['ws:node:libs/lodash']);
    assert.equal(env.artifact.edges.filter(e => e.from === 'ws:node:.').length, 0);
    assert.deepEqual(env.artifact.externals, []);
  });

  test('rust: local nodes never eligible → registry dep always external', () => {
    const dir = makeFixture({
      'app/Cargo.toml': [
        '[package]', 'name = "app"',
        '[dependencies]', 'serde = "1.0"', 'util = { path = "../util" }',
      ].join('\n'),
      'util/Cargo.toml': '[package]\nname = "serde"\n',
    });
    const env = mapJson(dir);
    const key = e => `${e.from}→${e.to}:${e.resolution}`;
    const keys = env.artifact.edges.map(key);
    assert.ok(keys.includes('ws:rust:app→ext:rust:serde:external'),
      'in-corpus crate named serde must not block externality (rust exception)');
    assert.ok(keys.includes('ws:rust:app→ws:rust:util:local'), 'path form still local');
    assert.equal(env.artifact.unresolvedDeclarations.length, 0);
  });
});

// ---------------------------------------------------------------------------
// E2E: invariant — 不支援或畸形語法 ⇒ partial 診斷，⇏ 任何猜測邊
// ---------------------------------------------------------------------------
describe('unsupported syntax fail-closed', () => {
  test('git-URL node spec → coverage partial + zero records for that name', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { express: '^4.18.0', mylib: 'git+https://example.com/mylib.git' },
      }),
    });
    const env = mapJson(dir);
    const cov = env.artifact.coverage.find(c => c.manifest === 'package.json');
    assert.equal(cov.status, 'partial');
    assert.equal(cov.reason, 'manifest_parse_incomplete');
    assert.ok(cov.unsupported.some(u => u.construct.includes('mylib')));
    const mentions = [...env.artifact.edges, ...env.artifact.unresolvedDeclarations]
      .filter(x => (x.to ?? x.requested?.name ?? '').includes('mylib'));
    assert.deepEqual(mentions, [], 'no guessed edge and no unresolved for unsupported spec');
    assert.ok(env.artifact.edges.some(e => e.to === 'ext:node:express'), 'proven edge stands');
  });
});

// ---------------------------------------------------------------------------
// E2E: go compound declarations (§3.6)
// ---------------------------------------------------------------------------
describe('go compound declarations E2E', () => {
  test('path replace → local edge with module identity check', () => {
    const dir = makeFixture({
      'services/api/go.mod': [
        'module example.com/api', 'go 1.22',
        'require example.com/lib v1.0.0',
        'require example.com/other v0.3.0',
        'replace example.com/lib => ../../lib',
      ].join('\n'),
      'lib/go.mod': 'module example.com/lib\ngo 1.22\n',
    });
    const env = mapJson(dir);
    const key = e => `${e.from}→${e.to}:${e.resolution}`;
    const keys = env.artifact.edges.map(key);
    assert.ok(keys.includes('ws:go:services/api→ws:go:lib:local'));
    assert.ok(keys.includes('ws:go:services/api→ext:go:example.com/other:external'));
    assert.equal(env.artifact.unresolvedDeclarations.length, 0);
  });

  test('module-to-module replace = blocker → zero edge, zero unresolved, partial', () => {
    const dir = makeFixture({
      'go.mod': [
        'module example.com/app', 'go 1.22',
        'require example.com/old v0.9.0',
        'replace example.com/old v0.9.0 => example.com/new v2.0.0',
      ].join('\n'),
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.edges.length, 0);
    assert.equal(env.artifact.unresolvedDeclarations.length, 0);
    const cov = env.artifact.coverage.find(c => c.manifest === 'go.mod');
    assert.equal(cov.status, 'partial');
    assert.ok(cov.unsupported.some(u => u.construct.includes('module-to-module replace')));
  });

  test('go.work confirms members; require across modules resolves local', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse (\n\t./modA\n\t./modB\n)\n',
      'modA/go.mod': 'module example.com/a\ngo 1.22\nrequire example.com/b v0.1.0\n',
      'modB/go.mod': 'module example.com/b\ngo 1.22\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.id === 'ctl:go_work:.');
    assert.deepEqual(ctl.members, ['ws:go:modA', 'ws:go:modB']);
    const roles = Object.fromEntries(env.artifact.workspaces.map(w => [w.id, w.role]));
    assert.equal(roles['ws:go:modA'], 'confirmed_workspace');
    assert.ok(env.artifact.edges.some(e =>
      e.from === 'ws:go:modA' && e.to === 'ws:go:modB' && e.resolution === 'local'));
  });
});

// ---------------------------------------------------------------------------
// E2E: cargo workspace template inheritance (§3.6)
// ---------------------------------------------------------------------------
describe('cargo template inheritance E2E', () => {
  test('workspace=true expands template; missing template → template:null evidence', () => {
    const dir = makeFixture({
      'Cargo.toml': [
        '[workspace]', 'members = ["crates/*"]',
        '[workspace.dependencies]',
        'mylib = { path = "crates/mylib" }',
        'anyhow = "1.0"',
      ].join('\n'),
      'crates/consumer/Cargo.toml': [
        '[package]', 'name = "consumer"',
        '[dependencies]',
        'mylib = { workspace = true }',
        'anyhow = { workspace = true }',
        'ghost = { workspace = true }',
      ].join('\n'),
      'crates/mylib/Cargo.toml': '[package]\nname = "mylib"\n',
    });
    const env = mapJson(dir);
    const key = e => `${e.from}→${e.to}:${e.resolution}`;
    const keys = env.artifact.edges.map(key);
    assert.ok(keys.includes('ws:rust:crates/consumer→ws:rust:crates/mylib:local'));
    assert.ok(keys.includes('ws:rust:crates/consumer→ext:rust:anyhow:external'));
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'ghost');
    assert.equal(u.reason, 'missing_workspace_template');
    assert.equal(u.evidence.template, null);
    const local = env.artifact.edges.find(e => e.to === 'ws:rust:crates/mylib');
    assert.equal(local.evidence.template.manifest, 'Cargo.toml', 'template provenance recorded');
  });

  test('virtual workspace root ([workspace] without [package]) is controller-only', () => {
    const dir = makeFixture({
      'Cargo.toml': '[workspace]\nmembers = ["crates/one"]\n',
      'crates/one/Cargo.toml': '[package]\nname = "one"\n',
    });
    const env = mapJson(dir);
    assert.deepEqual(env.artifact.workspaces.map(w => w.id), ['ws:rust:crates/one']);
    assert.equal(env.artifact.controllers[0].controllerType, 'cargo_workspace');
    assert.deepEqual(env.artifact.controllers[0].members, ['ws:rust:crates/one']);
  });
});

// ---------------------------------------------------------------------------
// E2E: php + python ecosystems
// ---------------------------------------------------------------------------
describe('php and python E2E', () => {
  test('composer require/require-dev map to scopes and resolve external', () => {
    const dir = makeFixture({
      'composer.json': JSON.stringify({
        name: 'acme/app',
        require: { 'monolog/monolog': '^3.0' },
        'require-dev': { 'phpunit/phpunit': '^11.0' },
      }),
    });
    const env = mapJson(dir);
    const byName = Object.fromEntries(env.artifact.edges.map(e => [e.to, e.scope]));
    assert.equal(byName['ext:php:monolog/monolog'], 'runtime');
    assert.equal(byName['ext:php:phpunit/phpunit'], 'development');
  });

  test('pyproject deps resolve; PEP 508 direct reference → partial, no edge', () => {
    const dir = makeFixture({
      'pyproject.toml': [
        '[project]', 'name = "my-tool"',
        'dependencies = [', '  "requests>=2.28",', '  "weird-pkg @ git+https://example.com/w.git",', ']',
        '[project.optional-dependencies]', 'dev = ["pytest>=8.0"]',
      ].join('\n'),
    });
    const env = mapJson(dir);
    const scopes = Object.fromEntries(env.artifact.edges.map(e => [e.to, e.scope]));
    assert.equal(scopes['ext:python:requests'], 'runtime');
    assert.equal(scopes['ext:python:pytest'], 'optional');
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'pyproject.toml').status, 'partial');
    assert.ok(!env.artifact.edges.some(e => e.to.includes('weird-pkg')));
    assert.deepEqual(env.artifact.unresolvedDeclarations, [],
      'unsupported spec must not leak into unresolved either');
  });
});

// ---------------------------------------------------------------------------
// E2E: path validation — outside_corpus / missing_target (§3.6)
// ---------------------------------------------------------------------------
describe('path validation E2E', () => {
  test('escape via ../ and via symlink → outside_corpus; missing → missing_target', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mmap-esc-'));
    tmpDirs.push(parent);
    const dir = path.join(parent, 'repo');
    fs.mkdirSync(path.join(dir, 'outside-link-target'), { recursive: true });
    fs.mkdirSync(path.join(parent, 'outside'), { recursive: true });
    fs.writeFileSync(path.join(parent, 'outside', 'package.json'), JSON.stringify({ name: 'esc' }));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'app',
      dependencies: {
        esc: 'file:../outside',
        linked: 'file:./ext-link',
        gone: 'file:./no-such-dir',
      },
    }));
    fs.symlinkSync(path.join(parent, 'outside'), path.join(dir, 'ext-link'));
    const env = mapJson(dir);
    const reasons = Object.fromEntries(
      env.artifact.unresolvedDeclarations.map(u => [u.requested.name, u.reason]));
    assert.equal(reasons.esc, 'outside_corpus');
    assert.equal(reasons.linked, 'outside_corpus', 'symlink escape must not resolve local');
    assert.equal(reasons.gone, 'missing_target');
    assert.equal(env.artifact.edges.length, 0);
  });
});

// ---------------------------------------------------------------------------
// E2E: cycles + determinism on a 400-node chain (iterative Tarjan, §3.8)
// ---------------------------------------------------------------------------
describe('cycles and determinism', () => {
  let dir;
  before(() => {
    // 400-node ring within the 500-manifest budget; names p001…p400 are a
    // scale fixture (justified synthetic data — uniqueness is the property).
    const files = {
      'package.json': JSON.stringify({ name: 'ring-root', workspaces: ['pkgs/*'] }),
    };
    const nm = i => `p${String(i).padStart(3, '0')}`;
    for (let i = 1; i <= 400; i++) {
      const next = nm(i === 400 ? 1 : i + 1);
      files[`pkgs/${nm(i)}/package.json`] = JSON.stringify({
        name: nm(i), dependencies: { [next]: 'workspace:*' },
      });
    }
    dir = makeFixture(files);
  });

  test('single 400-node SCC found without recursion, deterministic ordering', () => {
    const env = mapJson(dir, ['--cycles']);
    assert.equal(env.query.kind, 'cycles');
    assert.equal(env.query.results.length, 1);
    const cyc = env.query.results[0];
    assert.equal(cyc.nodes.length, 400);
    assert.equal(cyc.edges.length, 400);
    assert.equal(cyc.classification, 'runtime');
    assert.equal(cyc.nodes[0], 'ws:node:pkgs/p001');
  });

  test('two runs produce identical envelopes modulo generatedAt/root', () => {
    const canon = env => {
      delete env.artifact.generatedAt;
      delete env.artifact.root;
      return env;
    };
    const a = canon(mapJson(dir));
    const b = canon(mapJson(dir));
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// E2E: budget + omissions (§3.7)
// ---------------------------------------------------------------------------
describe('manifest budget', () => {
  test('over-budget corpus truncates deterministically with omissions record', () => {
    const files = {};
    for (let i = 1; i <= 505; i++) {
      const nm = `m${String(i).padStart(3, '0')}`;
      files[`mods/${nm}/package.json`] = JSON.stringify({ name: nm });
    }
    const dir = makeFixture(files);
    const env = mapJson(dir);
    assert.equal(env.artifact.workspaces.length, 500);
    const om = env.artifact.omissions.find(o => o.reason === 'manifest_budget');
    assert.equal(om.count, 5);
    assert.deepEqual(om.sample,
      [501, 502, 503, 504, 505].map(i => `mods/m${i}/package.json`),
      'path-sorted truncation drops exactly the lexicographic tail');
    assert.ok(!env.artifact.workspaces.some(w => w.manifest === 'mods/m501/package.json'));
  });
});

// ---------------------------------------------------------------------------
// E2E: CLI contract — exit 2 on invalid input, md default output
// ---------------------------------------------------------------------------
describe('CLI contract', () => {
  test('invalid arguments exit 2 with usage', () => {
    const dir = makeFixture({ 'package.json': JSON.stringify({ name: 'app' }) });
    assert.equal(runMap(dir, ['--format', 'xml']).status, 2);
    assert.equal(runMap(dir, ['--reverse', 'x', '--cycles']).status, 2);
    assert.equal(runMap(dir, ['--frobnicate']).status, 2);
    assert.equal(runMap(dir, ['--top', '0']).status, 2);
    const notFound = runMap(dir, ['--reverse', 'no-such-pkg']);
    assert.equal(notFound.status, 2);
    assert.match(notFound.stderr, /selector not found/);
  });

  test('md is the default projection and carries the semantics disclaimer', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'app', dependencies: { express: '^4.0.0' } }),
    });
    const r = runMap(dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /# Manifest Map/);
    assert.match(r.stdout, /declares_dependency/);
    assert.match(r.stdout, /不證明 import/);
  });

  test('--top truncates md lists; json ignores it with a diagnostic', () => {
    const files = { 'package.json': JSON.stringify({ name: 'root', workspaces: ['w/*'] }) };
    for (let i = 1; i <= 15; i++) {
      files[`w/c${String(i).padStart(2, '0')}/package.json`] = JSON.stringify({ name: `c${i}` });
    }
    const dir = makeFixture(files);
    const md = runMap(dir, ['--top', '3']);
    assert.match(md.stdout, /more omitted; --top 3/);
    const env = mapJson(dir, ['--top', '3']);
    assert.equal(env.artifact.workspaces.length, 16, 'json artifact is never truncated');
    assert.ok(env.artifact.diagnostics.some(d => d.code === 'top_ignored_in_json'));
  });
});

// ---------------------------------------------------------------------------
// E2E: fixture flags + candidate default exclusion (§3.4)
// ---------------------------------------------------------------------------
describe('candidate exclusion and fixture markers', () => {
  test('unconfirmed nested manifests are candidates, excluded until --include-candidates', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'app', dependencies: { helper: '*' } }),
      'examples/demo/package.json': JSON.stringify({ name: 'helper' }),
    });
    const env = mapJson(dir);
    const cand = env.artifact.workspaces.find(w => w.id === 'ws:node:examples/demo');
    assert.equal(cand.role, 'candidate_workspace');
    assert.ok(cand.flags.includes('likely_fixture'));
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'helper');
    assert.equal(u.reason, 'unverified_workspace_match', 'candidate blocks external proof');
    const inc = mapJson(dir, ['--include-candidates']);
    assert.ok(inc.artifact.edges.some(e =>
      e.from === 'ws:node:.' && e.to === 'ws:node:examples/demo' && e.resolution === 'local'),
    'star + unique match resolves local once candidate is included');
  });
});

// ---------------------------------------------------------------------------
// E2E: git corpus — untracked visible, ignored excluded, spaced paths intact
// ---------------------------------------------------------------------------
describe('git corpus enumeration', () => {
  test('untracked manifests included, hostile paths survive NUL split untrimmed', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'gitapp' }),
      'my pkg/package.json': JSON.stringify({ name: 'spaced' }),
      ' lead/package.json': JSON.stringify({ name: 'lead-pkg' }),
      'nl\nname/package.json': JSON.stringify({ name: 'newline-pkg' }),
    });
    const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const ids = mapJson(dir).artifact.workspaces.map(w => w.id);
    assert.ok(ids.includes('ws:node:.'), 'untracked manifest visible via --others');
    assert.ok(ids.includes('ws:node:my pkg'), 'path with space survives NUL split');
    assert.ok(ids.includes('ws:node: lead'), 'leading whitespace not trimmed');
    assert.ok(ids.includes('ws:node:nl\nname'), 'newline in dir name survives NUL split');
  });

  test('.gitignore excludes manifests from corpus and coverage alike', () => {
    const dir = makeFixture({
      '.gitignore': 'ignored/\n',
      'package.json': JSON.stringify({ name: 'gitapp' }),
      'ignored/package.json': JSON.stringify({ name: 'hidden' }),
    });
    const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const env = mapJson(dir);
    assert.deepEqual(env.artifact.workspaces.map(w => w.id), ['ws:node:.']);
    assert.ok(!env.artifact.coverage.some(c => c.manifest.startsWith('ignored/')));
  });
});

// ---------------------------------------------------------------------------
// E2E: run-skill.sh entrypoint (§6 invariant)
// ---------------------------------------------------------------------------
describe('run-skill.sh entrypoint', () => {
  test('scripts/run-skill.sh repo-intake manifest_map.js works from a fixture cwd', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'app', dependencies: { express: '^4.0.0' } }),
    });
    const r = spawnSync('/bin/bash', ['-p', path.join(REPO_ROOT, 'scripts', 'run-skill.sh'),
      'repo-intake', 'manifest_map.js', '--format', 'json'], {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(r.status, 0, r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.schemaVersion, 1);
    assert.ok(env.artifact.edges.some(e => e.to === 'ext:node:express'));
  });
});

// ---------------------------------------------------------------------------
// Edge inputs: empty corpus, BOM, oversized manifest
// ---------------------------------------------------------------------------
describe('edge inputs', () => {
  test('empty corpus yields empty artifact, exit 0', () => {
    const dir = makeFixture({ 'README.md': '# nothing here\n' });
    const env = mapJson(dir);
    assert.deepEqual(env.artifact.workspaces, []);
    assert.deepEqual(env.artifact.edges, []);
    assert.deepEqual(env.artifact.omissions, []);
  });

  test('BOM-prefixed package.json still parses', () => {
    const dir = makeFixture({
      'package.json': '﻿' + JSON.stringify({ name: 'bom-app', dependencies: { express: '^4.0.0' } }),
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.workspaces[0].name, 'bom-app');
    assert.equal(env.artifact.coverage[0].status, 'parsed');
  });

  test('manifest over byte budget → skipped with budget_exceeded', () => {
    const big = JSON.stringify({ name: 'big', description: 'x'.repeat(1_100_000) });
    const dir = makeFixture({ 'package.json': big, 'ok/package.json': JSON.stringify({ name: 'ok-pkg' }) });
    const env = mapJson(dir);
    const cov = Object.fromEntries(env.artifact.coverage.map(c => [c.manifest, c]));
    assert.equal(cov['package.json'].status, 'skipped');
    assert.equal(cov['package.json'].reason, 'budget_exceeded');
    assert.equal(cov['ok/package.json'].status, 'parsed');
    assert.ok(!env.artifact.workspaces.some(w => w.name === 'big'));
  });

  test('non-UTF-8 manifest → skipped unreadable, not crash', () => {
    const dir = makeFixture({ 'ok/package.json': JSON.stringify({ name: 'ok-pkg' }) });
    fs.writeFileSync(path.join(dir, 'package.json'), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
    const env = mapJson(dir);
    const cov = env.artifact.coverage.find(c => c.manifest === 'package.json');
    assert.equal(cov.status, 'skipped');
    assert.equal(cov.reason, 'unreadable');
  });

  test('truncated JSON, detection-only file, unnamed root, CRLF+BOM go.mod', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ dependencies: { express: '^4.18.0' } }),
      'Gemfile': "source 'https://rubygems.org'\ngem 'rails'\n",
      'cut/package.json': '{"name": "tru',
      'gomod/go.mod': '﻿module example.com/m\r\ngo 1.22\r\nrequire example.com/x v1.0.0\r\n',
    });
    const env = mapJson(dir);
    const cov = Object.fromEntries(env.artifact.coverage.map(c => [c.manifest, c]));
    assert.equal(cov['Gemfile'].status, 'unrecognized');
    assert.equal(cov['cut/package.json'].status, 'skipped');
    assert.equal(cov['gomod/go.mod'].status, 'parsed', 'CRLF+BOM must not degrade go.mod');
    const root = env.artifact.workspaces.find(w => w.id === 'ws:node:.');
    assert.equal(root.name, null);
    assert.equal(root.nameSource, null);
    assert.ok(env.artifact.edges.some(e => e.to === 'ext:go:example.com/x'));
  });

  test('boundedRead rejects oversized files via fstat before any content read', () => {
    const dir = makeFixture({});
    const p = path.join(dir, 'big.json');
    fs.writeFileSync(p, 'x'.repeat(4096));
    const origRead = fs.readSync;
    let readCalls = 0;
    fs.readSync = (...args) => { readCalls += 1; return origRead(...args); };
    try {
      const rejected = mm.boundedRead(p, 1024);
      assert.equal(rejected.status, 'budget_exceeded');
      assert.equal(readCalls, 0, 'fstat must reject before content is read');
      const accepted = mm.boundedRead(p, 8192);
      assert.equal(accepted.status, 'ok');
      assert.ok(readCalls > 0, 'control: within budget the content IS read');
    } finally {
      fs.readSync = origRead;
    }
  });

  test('unsupported syntax in unrelated TOML sections leaves coverage parsed', () => {
    const dir = makeFixture({
      'Cargo.toml': [
        '[package]', 'name = "clean-app"',
        '[profile.release]', 'opt-level = { weird = [1,', 'lto ~~ nonsense',
      ].join('\n'),
      'py/pyproject.toml': [
        '[project]', 'name = "clean-tool"', 'dependencies = ["requests>=2.0"]',
        '[tool.ruff]', 'select ~~ nonsense', 'line-length = { odd = (',
      ].join('\n'),
    });
    const env = mapJson(dir);
    const cov = Object.fromEntries(env.artifact.coverage.map(c => [c.manifest, c]));
    assert.equal(cov['Cargo.toml'].status, 'parsed');
    assert.equal(cov['py/pyproject.toml'].status, 'parsed');
    assert.ok(env.artifact.edges.some(e => e.to === 'ext:python:requests'),
      'real dependencies in the same file still parse');
  });

  test('same-directory polyglot manifests → two nodes, IDs never collide', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'js-side' }),
      'Cargo.toml': '[package]\nname = "rust-side"\n',
    });
    const env = mapJson(dir);
    assert.deepEqual(env.artifact.workspaces.map(w => w.id), ['ws:node:.', 'ws:rust:.']);
    assert.deepEqual(env.artifact.workspaces.map(w => w.name), ['js-side', 'rust-side']);
  });
});

// ---------------------------------------------------------------------------
// §3.4/§6: controller membership state machine
// ---------------------------------------------------------------------------
describe('controller membership state machine', () => {
  test('unsupported include pattern → partial, proven members still confirmed', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'root', workspaces: ['packages/*', 'nested/**'],
      }),
      'packages/a/package.json': JSON.stringify({ name: 'pkg-a' }),
      'nested/deep/x/package.json': JSON.stringify({ name: 'deep-x' }),
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.id === 'ctl:node_workspaces:.');
    assert.equal(ctl.membershipStatus, 'partial');
    assert.deepEqual(ctl.members, ['ws:node:packages/a']);
    assert.ok(ctl.diagnostics.some(d => d.value === 'nested/**'));
    const roles = Object.fromEntries(env.artifact.workspaces.map(w => [w.id, w.role]));
    assert.equal(roles['ws:node:packages/a'], 'confirmed_workspace');
    assert.equal(roles['ws:node:nested/deep/x'], 'candidate_workspace');
  });

  test('object-form workspaces field → partial controller, zero confirmed members', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'root', workspaces: { packages: ['packages/*'] },
      }),
      'packages/a/package.json': JSON.stringify({ name: 'pkg-a' }),
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.id === 'ctl:node_workspaces:.');
    assert.equal(ctl.membershipStatus, 'partial');
    assert.deepEqual(ctl.members, []);
    const a = env.artifact.workspaces.find(w => w.id === 'ws:node:packages/a');
    assert.equal(a.role, 'candidate_workspace');
  });

  test('cargo workspace.exclude with supported pattern actually excludes', () => {
    const dir = makeFixture({
      'Cargo.toml': [
        '[workspace]',
        'members = ["crates/*"]',
        'exclude = ["crates/skip"]',
      ].join('\n'),
      'crates/keep/Cargo.toml': '[package]\nname = "keep"\n',
      'crates/skip/Cargo.toml': '[package]\nname = "skip"\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'cargo_workspace');
    assert.equal(ctl.membershipStatus, 'parsed');
    assert.deepEqual(ctl.members, ['ws:rust:crates/keep']);
    const roles = Object.fromEntries(env.artifact.workspaces.map(w => [w.id, w.role]));
    assert.equal(roles['ws:rust:crates/keep'], 'confirmed_workspace');
    assert.equal(roles['ws:rust:crates/skip'], 'candidate_workspace');
  });

  test('unsupported exclude → controller unknown, members omitted, matches stay candidate', () => {
    const dir = makeFixture({
      'Cargo.toml': [
        '[workspace]',
        'members = ["crates/*"]',
        'exclude = ["crates/**"]',
      ].join('\n'),
      'crates/one/Cargo.toml': '[package]\nname = "one"\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'cargo_workspace');
    assert.equal(ctl.membershipStatus, 'unknown');
    assert.ok(!('members' in ctl), 'unknown controller must omit members entirely');
    assert.ok(ctl.diagnostics.some(d => d.construct === 'unsupported exclude pattern'));
    const one = env.artifact.workspaces.find(w => w.id === 'ws:rust:crates/one');
    assert.equal(one.role, 'candidate_workspace',
      'no other eligible controller → match stays candidate');
  });

  test('overlap: unknown controller A + parsed controller B → role confirmed', () => {
    const dir = makeFixture({
      'Cargo.toml': [
        '[workspace]',
        'members = ["crates/*"]',
        'exclude = ["bad/**"]',
      ].join('\n'),
      'crates/Cargo.toml': '[workspace]\nmembers = ["x"]\n',
      'crates/x/Cargo.toml': '[package]\nname = "x-crate"\n',
    });
    const env = mapJson(dir);
    const a = env.artifact.controllers.find(c => c.id === 'ctl:cargo_workspace:.');
    const b = env.artifact.controllers.find(c => c.id === 'ctl:cargo_workspace:crates');
    assert.equal(a.membershipStatus, 'unknown');
    assert.ok(!('members' in a));
    assert.deepEqual(b.members, ['ws:rust:crates/x']);
    const x = env.artifact.workspaces.find(w => w.id === 'ws:rust:crates/x');
    assert.equal(x.role, 'confirmed_workspace', 'confirmation is monotone across controllers');
  });

  test('two same-type controllers in one repo stay isolated', () => {
    const dir = makeFixture({
      'teamA/package.json': JSON.stringify({ name: 'team-a', workspaces: ['libs/*'] }),
      'teamA/libs/one/package.json': JSON.stringify({ name: 'a-one' }),
      'teamB/package.json': JSON.stringify({ name: 'team-b', workspaces: ['libs/*'] }),
      'teamB/libs/two/package.json': JSON.stringify({ name: 'b-two' }),
    });
    const env = mapJson(dir);
    const ids = env.artifact.controllers.map(c => c.id);
    assert.deepEqual(ids, ['ctl:node_workspaces:teamA', 'ctl:node_workspaces:teamB']);
    const [a, b] = env.artifact.controllers;
    assert.deepEqual(a.members, ['ws:node:teamA/libs/one']);
    assert.deepEqual(b.members, ['ws:node:teamB/libs/two']);
  });

  test('nested Cargo [package]+[workspace]: controller exists, own node stays candidate', () => {
    const dir = makeFixture({
      'crates/nested/Cargo.toml': [
        '[package]', 'name = "nested-pkg"',
        '[workspace]', 'members = ["sub/*"]',
      ].join('\n'),
      'crates/nested/sub/x/Cargo.toml': '[package]\nname = "sub-x"\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.id === 'ctl:cargo_workspace:crates/nested');
    assert.deepEqual(ctl.members, ['ws:rust:crates/nested/sub/x']);
    const roles = Object.fromEntries(env.artifact.workspaces.map(w => [w.id, w.role]));
    assert.equal(roles['ws:rust:crates/nested'], 'candidate_workspace',
      'controller identity does not confirm its own manifest node');
    assert.equal(roles['ws:rust:crates/nested/sub/x'], 'confirmed_workspace');
  });

  test('membership mechanisms alone produce zero edges (cargo / go.work / template)', () => {
    const cargo = makeFixture({
      'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nexclude = ["crates/skip"]\n',
      'crates/keep/Cargo.toml': '[package]\nname = "keep"\n',
      'crates/skip/Cargo.toml': '[package]\nname = "skip"\n',
    });
    assert.deepEqual(mapJson(cargo).artifact.edges, [], 'cargo members/exclude declare no edge');
    const gowork = makeFixture({
      'go.work': 'go 1.22\nuse (\n\t./modA\n\t./modB\n)\n',
      'modA/go.mod': 'module example.com/a\ngo 1.22\n',
      'modB/go.mod': 'module example.com/b\ngo 1.22\n',
    });
    assert.deepEqual(mapJson(gowork).artifact.edges, [], 'go.work use declares no edge');
    const tpl = makeFixture({
      'Cargo.toml': [
        '[workspace]', 'members = ["crates/*"]',
        '[workspace.dependencies]', 'shared = { path = "crates/shared" }',
      ].join('\n'),
      'crates/shared/Cargo.toml': '[package]\nname = "shared"\n',
    });
    assert.deepEqual(mapJson(tpl).artifact.edges, [],
      'a template entry with no member workspace=true consumer declares no edge');
  });

  test('pnpm-workspace.yaml → unknown controller, unrecognized coverage', () => {
    const dir = makeFixture({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/a/package.json': JSON.stringify({ name: 'pkg-a' }),
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.id === 'ctl:pnpm_workspace:.');
    assert.equal(ctl.membershipStatus, 'unknown');
    assert.ok(!('members' in ctl));
    const cov = env.artifact.coverage.find(c => c.manifest === 'pnpm-workspace.yaml');
    assert.equal(cov.status, 'unrecognized');
    const a = env.artifact.workspaces.find(w => w.id === 'ws:node:packages/a');
    assert.equal(a.role, 'candidate_workspace');
  });
});

// ---------------------------------------------------------------------------
// §3.6/§6: node version-spec grammar boundaries (frozen contract)
// ---------------------------------------------------------------------------
describe('node grammar boundary matrix', () => {
  test('OR whitespace both directions and bare v-prefix → range', () => {
    assert.equal(mm.matchesRangeGrammar('v1'), true);
    assert.equal(mm.matchesRangeGrammar('1||2'), true);
    assert.equal(mm.matchesRangeGrammar('1 || 2'), true);
  });

  test('empty OR segments in all three positions → catch-all', () => {
    assert.equal(mm.matchesRangeGrammar('1||'), false);
    assert.equal(mm.matchesRangeGrammar('||1'), false);
    assert.equal(mm.matchesRangeGrammar('1 ||'), false);
  });

  test('malformed combinations → catch-all', () => {
    assert.equal(mm.matchesRangeGrammar('>= <=1'), false, 'bare comparator token');
    assert.equal(mm.matchesRangeGrammar('1 - 2 - 3'), false, 'chained hyphen range');
    assert.equal(mm.matchesRangeGrammar('1.2.3-'), false, 'empty pre-release suffix');
    assert.equal(mm.matchesRangeGrammar('1.x.3'), false, 'wildcard not trailing');
    assert.equal(mm.matchesRangeGrammar('1.2.3.4.5'), false, 'too many parts');
  });

  test('classification of non-range non-tag forms → unsupported', () => {
    assert.equal(mm.classifyNodeSpec('1.2.3.4.5').kind, 'unsupported');
    assert.equal(mm.classifyNodeSpec('sd0x/dev-flow').kind, 'unsupported', 'GitHub shorthand');
    assert.equal(mm.classifyNodeSpec('2static').kind, 'unsupported', 'digit-leading tag');
    assert.equal(mm.classifyNodeSpec('https://example.com/p/-/p-1.0.0.tgz').kind, 'unsupported');
    assert.equal(mm.classifyNodeSpec('beta').kind, 'registry', 'letter-leading tag control');
  });
});

describe('node catch-all and dist-tag at graph level', () => {
  test('remote/alias/malformed specs → partial + zero edges + zero unresolved', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: {
          tarball: 'https://registry.example.com/t/-/t-1.0.0.tgz',
          shorthand: 'sd0x/dev-flow',
          aliased: 'npm:react@^18.0.0',
          broken: '>= <=1',
          express: '^4.18.0',
        },
      }),
    });
    const env = mapJson(dir);
    const cov = env.artifact.coverage.find(c => c.manifest === 'package.json');
    assert.equal(cov.status, 'partial');
    assert.equal(cov.unsupported.length, 4);
    assert.deepEqual(env.artifact.edges.map(e => e.to), ['ext:node:express'],
      'bare semver positive control produces the only edge');
    assert.deepEqual(env.artifact.unresolvedDeclarations, []);
  });

  test('dist-tag: zero match → external; exactly one arch match → unverified', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'root', workspaces: ['pkgs/*'],
        dependencies: { typescript: 'latest', helper: 'beta' },
      }),
      'pkgs/helper/package.json': JSON.stringify({ name: 'helper' }),
    });
    const env = mapJson(dir);
    assert.ok(env.artifact.edges.some(e => e.to === 'ext:node:typescript'),
      'no local candidate → dist-tag resolves external');
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'helper');
    assert.equal(u.reason, 'unverified_workspace_match');
    assert.deepEqual(u.candidates, ['ws:node:pkgs/helper']);
    assert.ok(!env.artifact.edges.some(e => e.to === 'ws:node:pkgs/helper'),
      'dist-tag cannot prove a workspace match');
  });

  test('same-ecosystem name collision → ambiguous with sorted candidates', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'root', workspaces: ['a/*', 'b/*'], dependencies: { 'dup-pkg': '*' },
      }),
      'a/dup/package.json': JSON.stringify({ name: 'dup-pkg' }),
      'b/dup/package.json': JSON.stringify({ name: 'dup-pkg' }),
    });
    const env = mapJson(dir);
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'dup-pkg');
    assert.equal(u.reason, 'ambiguous');
    assert.deepEqual(u.candidates, ['ws:node:a/dup', 'ws:node:b/dup'], 'sorted candidate IDs');
    assert.equal(env.artifact.edges.length, 0);
  });
});

// ---------------------------------------------------------------------------
// §3.6/§6: go replace applicability matrix
// ---------------------------------------------------------------------------
describe('go replace applicability', () => {
  test('orphan replace → zero records of any kind', () => {
    const dir = makeFixture({
      'go.mod': [
        'module example.com/app', 'go 1.22',
        'require example.com/dep v1.0.0',
        'replace example.com/unrelated => ../nowhere',
      ].join('\n'),
    });
    const env = mapJson(dir);
    assert.deepEqual(env.artifact.edges.map(e => e.to), ['ext:go:example.com/dep']);
    assert.deepEqual(env.artifact.unresolvedDeclarations, []);
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.mod').status, 'parsed');
    const all = JSON.stringify(env.artifact);
    assert.ok(!all.includes('example.com/unrelated'), 'orphan replace leaves no trace');
  });

  test('path replace with module identity mismatch → target_not_in_corpus', () => {
    const dir = makeFixture({
      'go.mod': [
        'module example.com/app', 'go 1.22',
        'require example.com/lib v1.0.0',
        'replace example.com/lib => ./vendor-lib',
      ].join('\n'),
      'vendor-lib/go.mod': 'module example.com/imposter\ngo 1.22\n',
    });
    const env = mapJson(dir);
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'example.com/lib');
    assert.equal(u.reason, 'target_not_in_corpus');
    assert.equal(env.artifact.edges.length, 0);
  });

  test('version-mismatched replaces are nonexistent: path kind falls to branch 3', () => {
    const dir = makeFixture({
      'app/go.mod': [
        'module example.com/app', 'go 1.22',
        'require example.com/lib v2.0.0',
        'replace example.com/lib v1.0.0 => ../lib',
      ].join('\n'),
      'lib/go.mod': 'module example.com/lib\ngo 1.22\n',
    });
    const env = mapJson(dir);
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'example.com/lib');
    assert.equal(u.reason, 'unverified_workspace_match',
      'in-corpus module without corroboration, replace treated as absent');
    assert.deepEqual(u.candidates, ['ws:go:lib']);
    assert.equal(env.artifact.edges.length, 0);
  });

  test('version-mismatched module-to-module replace does not block → external', () => {
    const dir = makeFixture({
      'go.mod': [
        'module example.com/app', 'go 1.22',
        'require example.com/old v1.0.0',
        'replace example.com/old v0.9.0 => example.com/new v2.0.0',
      ].join('\n'),
    });
    const env = mapJson(dir);
    assert.deepEqual(env.artifact.edges.map(e => e.to), ['ext:go:example.com/old']);
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.mod').status, 'parsed',
      'inapplicable replace must not degrade coverage');
  });

  test('version-mismatched go.work replace does not block and leaves no record', () => {
    const dir = makeFixture({
      'go.work': [
        'go 1.22', 'use ./modA',
        'replace example.com/dep v0.1.0 => ./vendor-dep',
      ].join('\n'),
      'modA/go.mod': 'module example.com/a\ngo 1.22\nrequire example.com/dep v1.0.0\n',
    });
    const env = mapJson(dir);
    assert.ok(env.artifact.edges.some(e => e.to === 'ext:go:example.com/dep'));
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.work').status, 'parsed');
    const ctl = env.artifact.controllers.find(c => c.id === 'ctl:go_work:.');
    assert.deepEqual(ctl.diagnostics, []);
  });

  test('applicable go.work replace blocks; attribution stays on go.work side', () => {
    const dir = makeFixture({
      'go.work': [
        'go 1.22', 'use ./modA',
        'replace example.com/dep => ./vendor-dep',
      ].join('\n'),
      'modA/go.mod': 'module example.com/a\ngo 1.22\nrequire example.com/dep v1.0.0\n',
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.edges.length, 0);
    assert.deepEqual(env.artifact.unresolvedDeclarations, []);
    const cov = Object.fromEntries(env.artifact.coverage.map(c => [c.manifest, c]));
    assert.equal(cov['go.work'].status, 'partial');
    assert.deepEqual(cov['go.work'].unsupported,
      [{ line: 3, construct: 'go.work replace: example.com/dep' }],
      'exactly one deduped record with line provenance');
    assert.equal(cov['modA/go.mod'].status, 'parsed', 'affected go.mod is not degraded');
    const ctl = env.artifact.controllers.find(c => c.id === 'ctl:go_work:.');
    assert.deepEqual(ctl.diagnostics,
      [{ construct: 'go.work replace', value: 'example.com/dep' }]);
  });

  test('orphan go.work replace (version-matched, no require) → zero records', () => {
    const dir = makeFixture({
      'go.work': [
        'go 1.22', 'use ./modA',
        'replace example.com/ghost => ./vendor-ghost',
      ].join('\n'),
      'modA/go.mod': 'module example.com/a\ngo 1.22\nrequire example.com/dep v1.0.0\n',
    });
    const env = mapJson(dir);
    assert.deepEqual(env.artifact.edges.map(e => e.to), ['ext:go:example.com/dep']);
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.work').status, 'parsed');
    assert.deepEqual(env.artifact.controllers.find(c => c.id === 'ctl:go_work:.').diagnostics, []);
    assert.ok(!JSON.stringify(env.artifact).includes('example.com/ghost'));
  });

  describe('independently applicable blockers', () => {
    let env;
    before(() => {
      const dir = makeFixture({
        'go.work': [
          'go 1.22', 'use ./modA',
          'replace example.com/dep => ./vendor1',
          'replace example.com/dep2 => ./vendor2',
        ].join('\n'),
        'sub/go.work': [
          'go 1.22',
          'replace example.com/dep => ./vendor3',
        ].join('\n'),
        'modA/go.mod': [
          'module example.com/a', 'go 1.22',
          'require example.com/dep v1.0.0',
          'require example.com/dep2 v1.0.0',
          'replace example.com/dep2 => example.com/other v9.9.9',
        ].join('\n'),
      });
      env = mapJson(dir);
    });

    test('each applicable blocker source gets exactly one coverage record', () => {
      assert.equal(env.artifact.edges.length, 0);
      assert.deepEqual(env.artifact.unresolvedDeclarations, []);
      const cov = Object.fromEntries(env.artifact.coverage.map(c => [c.manifest, c]));
      assert.deepEqual(cov['go.work'].unsupported, [
        { line: 3, construct: 'go.work replace: example.com/dep' },
        { line: 4, construct: 'go.work replace: example.com/dep2' },
      ], 'root go.work records both of its applicable replaces');
      assert.deepEqual(cov['sub/go.work'].unsupported,
        [{ line: 2, construct: 'go.work replace: example.com/dep' }],
        'second controller with an independently applicable replace is also partial');
      assert.deepEqual(cov['modA/go.mod'].unsupported,
        [{ line: 5, construct: 'module-to-module replace: example.com/dep2' }],
        'coexisting go.mod blocker is recorded alongside the go.work one');
    });

    test('diagnostics and statuses attribute to each originating controller', () => {
      const cov = Object.fromEntries(env.artifact.coverage.map(c => [c.manifest, c]));
      assert.equal(cov['go.work'].status, 'partial');
      assert.equal(cov['sub/go.work'].status, 'partial');
      assert.equal(cov['modA/go.mod'].status, 'partial');
      const root = env.artifact.controllers.find(c => c.id === 'ctl:go_work:.');
      const sub = env.artifact.controllers.find(c => c.id === 'ctl:go_work:sub');
      assert.deepEqual(root.diagnostics, [
        { construct: 'go.work replace', value: 'example.com/dep' },
        { construct: 'go.work replace', value: 'example.com/dep2' },
      ], 'root controller carries exactly its own two diagnostics');
      assert.deepEqual(sub.diagnostics,
        [{ construct: 'go.work replace', value: 'example.com/dep' }],
        'nested controller diagnostic must not migrate to the root controller');
    });
  });

  test('one go.work replace blocking two requires is recorded exactly once', () => {
    const dir = makeFixture({
      'go.work': [
        'go 1.22',
        'use (', '\t./modA', '\t./modB', ')',
        'replace example.com/dep => ./vendor-dep',
      ].join('\n'),
      'modA/go.mod': 'module example.com/a\ngo 1.22\nrequire example.com/dep v1.0.0\n',
      'modB/go.mod': 'module example.com/b\ngo 1.22\nrequire example.com/dep v2.0.0\n',
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.edges.length, 0);
    assert.deepEqual(env.artifact.unresolvedDeclarations, []);
    const cov = Object.fromEntries(env.artifact.coverage.map(c => [c.manifest, c]));
    assert.deepEqual(cov['go.work'].unsupported,
      [{ line: 6, construct: 'go.work replace: example.com/dep' }],
      'two blocked requires, ONE declaration — dedupe must collapse to one record');
    const ctl = env.artifact.controllers.find(c => c.id === 'ctl:go_work:.');
    assert.deepEqual(ctl.diagnostics,
      [{ construct: 'go.work replace', value: 'example.com/dep' }],
      'one diagnostic, not one per blocked require');
  });

  test('one module-to-module replace blocking duplicate requires is recorded once', () => {
    const dir = makeFixture({
      'go.mod': [
        'module example.com/app',
        'require example.com/old v1.0.0',
        'require example.com/old v1.0.0',
        'replace example.com/old => example.com/new v2.0.0',
      ].join('\n'),
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.edges.length, 0);
    assert.deepEqual(env.artifact.unresolvedDeclarations, []);
    assert.deepEqual(env.artifact.coverage.find(c => c.manifest === 'go.mod').unsupported,
      [{ line: 4, construct: 'module-to-module replace: example.com/old' }],
      'recordGoModBlock dedupes by declaration line across both blocked requires');
  });

  test('in-corpus module without go.work corroboration → unverified_workspace_match', () => {
    const dir = makeFixture({
      'a/go.mod': 'module example.com/a\ngo 1.22\nrequire example.com/b v0.1.0\n',
      'b/go.mod': 'module example.com/b\ngo 1.22\n',
    });
    const env = mapJson(dir);
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'example.com/b');
    assert.equal(u.reason, 'unverified_workspace_match');
    assert.deepEqual(u.candidates, ['ws:go:b']);
    assert.equal(env.artifact.edges.length, 0);
  });
});

// ---------------------------------------------------------------------------
// §3.6/§6: remaining path-validation failure reasons
// ---------------------------------------------------------------------------
describe('path failure reasons (complete set)', () => {
  test('target_not_in_corpus / unreadable_target / budget_skipped_target, all edge-free', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: {
          bare: 'file:./bare-dir',
          garbled: 'file:./garbled',
          huge: 'file:./huge',
        },
      }),
      'bare-dir/README.md': 'a directory without any manifest\n',
      'huge/package.json': JSON.stringify({ name: 'huge', description: 'x'.repeat(1_100_000) }),
    });
    fs.mkdirSync(path.join(dir, 'garbled'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'garbled', 'package.json'), Buffer.from([0x7b, 0xff, 0x7d]));
    const env = mapJson(dir);
    const reasons = Object.fromEntries(
      env.artifact.unresolvedDeclarations.map(u => [u.requested.name, u.reason]));
    assert.equal(reasons.bare, 'target_not_in_corpus');
    assert.equal(reasons.garbled, 'unreadable_target');
    assert.equal(reasons.huge, 'budget_skipped_target');
    assert.equal(env.artifact.edges.length, 0, 'no failure reason may yield an edge');
  });
});

// ---------------------------------------------------------------------------
// §3.8/§6: graph invariants — cycles beyond the single ring
// ---------------------------------------------------------------------------
describe('cycle graph invariants', () => {
  test('root↔member cycle plus root self-loop; tie-break orders self-loop first', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'ring-root', workspaces: ['pkgs/*'],
        dependencies: { child: '*', 'ring-root': 'file:.' },
      }),
      'pkgs/child/package.json': JSON.stringify({
        name: 'child', dependencies: { 'ring-root': '*' },
      }),
    });
    const env = mapJson(dir, ['--cycles']);
    assert.equal(env.query.results.length, 2);
    const [selfLoop, scc] = env.query.results;
    assert.equal(selfLoop.selfLoop, true);
    assert.deepEqual(selfLoop.nodes, ['ws:node:.']);
    assert.deepEqual(scc.nodes, ['ws:node:.', 'ws:node:pkgs/child']);
    assert.equal(scc.selfLoop, false);
  });

  test('development-only and mixed-scope cycle classification', () => {
    const dev = makeFixture({
      'a/package.json': JSON.stringify({ name: 'dev-a', devDependencies: { 'dev-b': 'file:../b' } }),
      'b/package.json': JSON.stringify({ name: 'dev-b', devDependencies: { 'dev-a': 'file:../a' } }),
    });
    const devEnv = mapJson(dev, ['--cycles', '--include-candidates']);
    assert.equal(devEnv.query.results[0].classification, 'development');
    const mixed = makeFixture({
      'a/package.json': JSON.stringify({ name: 'mx-a', devDependencies: { 'mx-b': 'file:../b' } }),
      'b/package.json': JSON.stringify({ name: 'mx-b', dependencies: { 'mx-a': 'file:../a' } }),
    });
    const mixedEnv = mapJson(mixed, ['--cycles', '--include-candidates']);
    assert.equal(mixedEnv.query.results[0].classification, 'mixed');
  });

  test('duplicate declarations collapse; distinct cfg conditions do not', () => {
    const dup = makeFixture({
      'go.work': 'go 1.22\nuse (\n\t./modA\n\t./modB\n)\n',
      'modA/go.mod': [
        'module example.com/a', 'go 1.22',
        'require example.com/b v0.1.0', 'require example.com/b v0.1.0',
      ].join('\n'),
      'modB/go.mod': 'module example.com/b\ngo 1.22\nrequire example.com/a v0.1.0\n',
    });
    const dupEnv = mapJson(dup, ['--cycles']);
    assert.equal(dupEnv.query.results[0].edges.length, 2,
      'identical (from,to,scope,condition) tuples collapse to one');
    const cfg = makeFixture({
      'x/Cargo.toml': [
        '[package]', 'name = "cfg-x"',
        '[dependencies]', 'cfg-y = { path = "../y" }',
        "[target.'cfg(unix)'.dependencies]", 'cfg-y = { path = "../y" }',
      ].join('\n'),
      'y/Cargo.toml': [
        '[package]', 'name = "cfg-y"',
        '[dependencies]', 'cfg-x = { path = "../x" }',
      ].join('\n'),
    });
    const cfgEnv = mapJson(cfg, ['--cycles', '--include-candidates']);
    const cyc = cfgEnv.query.results[0];
    assert.equal(cyc.edges.length, 3, 'same endpoints, different cfg condition stay distinct');
    assert.equal(cyc.edges[0].condition, null, 'null condition sorts first within the cycle');
    assert.equal(cyc.edges[1].condition, 'cfg(unix)');
  });

  test('unresolved declarations never enter traversal', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'top', workspaces: ['pkgs/*'] }),
      'pkgs/a/package.json': JSON.stringify({ name: 'loop-a', dependencies: { 'loop-b': 'file:../b' } }),
      'pkgs/b/package.json': JSON.stringify({ name: 'loop-b', dependencies: { 'loop-a': '^1.0.0' } }),
    });
    const env = mapJson(dir, ['--cycles']);
    assert.deepEqual(env.query.results, [],
      'range spec back-edge is unresolved, so no cycle closes through it');
    const full = mapJson(dir);
    assert.equal(full.artifact.unresolvedDeclarations[0].reason, 'unverified_workspace_match');
  });

  test('iterative Tarjan survives a 5000-node ring without recursion', () => {
    const archSet = new Set();
    const edges = [];
    const id = i => `ws:node:chain/n${String(i).padStart(4, '0')}`;
    for (let i = 0; i < 5000; i++) {
      archSet.add(id(i));
      edges.push({
        from: id(i), to: id((i + 1) % 5000), relation: 'declares_dependency',
        scope: 'runtime', resolution: 'local', condition: null,
      });
    }
    const results = mm.findCycles({ edges, archSet });
    assert.equal(results.length, 1);
    assert.equal(results[0].nodes.length, 5000);
    assert.equal(results[0].edges.length, 5000);
  });
});

// ---------------------------------------------------------------------------
// §3.3/§3.6: evidence provenance and record shape
// ---------------------------------------------------------------------------
describe('evidence provenance', () => {
  test('declaration line numbers are recorded for node and go', () => {
    const dir = makeFixture({
      'package.json': [
        '{',
        '  "name": "line-app",',
        '  "dependencies": {',
        '    "express": "^4.18.0"',
        '  }',
        '}',
      ].join('\n'),
      'gomod/go.mod': 'module example.com/m\ngo 1.22\nrequire example.com/x v1.0.0\n',
    });
    const env = mapJson(dir);
    const nodeEdge = env.artifact.edges.find(e => e.to === 'ext:node:express');
    assert.deepEqual(nodeEdge.evidence, {
      declaration: { manifest: 'package.json', line: 4 },
    });
    const goEdge = env.artifact.edges.find(e => e.to === 'ext:go:example.com/x');
    assert.deepEqual(goEdge.evidence, {
      declaration: { manifest: 'gomod/go.mod', line: 3 },
    });
  });

  test('version template keeps template evidence; missing section → template null', () => {
    const withTpl = makeFixture({
      'Cargo.toml': [
        '[workspace]',
        'members = ["crates/*"]',
        '[workspace.dependencies]',
        'anyhow = "1.0"',
      ].join('\n'),
      'crates/user/Cargo.toml': [
        '[package]', 'name = "tpl-user"',
        '[dependencies]', 'anyhow = { workspace = true }',
      ].join('\n'),
    });
    const env = mapJson(withTpl);
    const edge = env.artifact.edges.find(e => e.to === 'ext:rust:anyhow');
    assert.deepEqual(edge.evidence.template, { manifest: 'Cargo.toml', line: 4 });
    assert.equal(edge.evidence.declaration.manifest, 'crates/user/Cargo.toml');
    const noSection = makeFixture({
      'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n',
      'crates/user/Cargo.toml': [
        '[package]', 'name = "no-tpl"',
        '[dependencies]', 'anyhow = { workspace = true }',
      ].join('\n'),
    });
    const env2 = mapJson(noSection);
    const u = env2.artifact.unresolvedDeclarations.find(x => x.requested.name === 'anyhow');
    assert.equal(u.reason, 'missing_workspace_template');
    assert.equal(u.evidence.template, null, 'whole-section-absent case, separate from key-absent');
  });

  test('renamed cargo dep, build scope, cfg condition, template-free evidence', () => {
    const dir = makeFixture({
      'Cargo.toml': [
        '[package]', 'name = "shape-app"',
        '[dependencies]', 'myalias = { version = "1.0", package = "actual-crate" }',
        '[build-dependencies]', 'cc = "1.0"',
        "[target.'cfg(windows)'.dependencies]", 'winapi = "0.3"',
      ].join('\n'),
    });
    const env = mapJson(dir);
    const byTo = Object.fromEntries(env.artifact.edges.map(e => [e.to, e]));
    assert.ok(byTo['ext:rust:actual-crate'], 'package = rename resolves the real name');
    assert.equal(byTo['ext:rust:cc'].scope, 'build');
    assert.equal(byTo['ext:rust:winapi'].condition, 'cfg(windows)');
    assert.ok(env.artifact.edges.every(e => !('template' in e.evidence)),
      'non-template records omit the template key entirely');
  });

  test('rawSpec in unresolved records is truncated to 200 chars', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'app', dependencies: { longpkg: 'workspace:' + 'x'.repeat(300) },
      }),
    });
    const env = mapJson(dir);
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'longpkg');
    assert.equal(u.reason, 'missing_workspace_member');
    assert.equal(u.requested.rawSpec.length, 200);
  });
});

// ---------------------------------------------------------------------------
// §3.8: reverse semantics — depth-1, selector forms, ambiguity
// ---------------------------------------------------------------------------
describe('reverse selector semantics', () => {
  test('reverse is depth-1: transitive dependents are excluded', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'chain-root', dependencies: { 'mid-pkg': 'file:./mid' },
      }),
      'mid/package.json': JSON.stringify({
        name: 'mid-pkg', dependencies: { 'leaf-pkg': 'file:../leaf' },
      }),
      'leaf/package.json': JSON.stringify({ name: 'leaf-pkg' }),
    });
    const env = mapJson(dir, ['--reverse', 'leaf-pkg', '--include-candidates']);
    assert.deepEqual(env.query.results.map(e => e.from), ['ws:node:mid'],
      'root depends on leaf only transitively — must not appear');
  });

  test('exact ext: selector and ecosystem-qualified name both resolve', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'app', dependencies: { express: '^4.18.0' } }),
    });
    const byId = mapJson(dir, ['--reverse', 'ext:node:express']);
    assert.equal(byId.query.selector, 'ext:node:express');
    assert.deepEqual(byId.query.results.map(e => e.from), ['ws:node:.']);
    const byEco = mapJson(dir, ['--reverse', 'node:express']);
    assert.equal(byEco.query.selector, 'ext:node:express');
  });

  test('ambiguous name selector exits 2 listing sorted matches', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['a/*', 'b/*'] }),
      'a/dup/package.json': JSON.stringify({ name: 'dup-pkg' }),
      'b/dup/package.json': JSON.stringify({ name: 'dup-pkg' }),
    });
    const r = runMap(dir, ['--reverse', 'dup-pkg']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ambiguous selector/);
    assert.match(r.stderr, /ws:node:a\/dup[\s\S]*ws:node:b\/dup/, 'sorted candidates listed');
  });
});

// ---------------------------------------------------------------------------
// §6: full E2E matrix through scripts/run-skill.sh
// ---------------------------------------------------------------------------
describe('run-skill.sh full mode matrix', () => {
  const runViaRunner = (cwd, args) => spawnSync('/bin/bash',
    ['-p', path.join(REPO_ROOT, 'scripts', 'run-skill.sh'),
      'repo-intake', 'manifest_map.js', ...args],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  let dir;
  before(() => {
    dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'runner-root', workspaces: ['pkgs/*'],
        dependencies: { express: '^4.18.0', 'cyc-a': '*', 'extra-pkg': '*' },
      }),
      'pkgs/cyc-a/package.json': JSON.stringify({
        name: 'cyc-a', dependencies: { 'runner-root': '*' },
      }),
      'examples/extra/package.json': JSON.stringify({ name: 'extra-pkg' }),
    });
  });

  test('md and json overviews both dispatch through the runner', () => {
    const md = runViaRunner(dir, []);
    assert.equal(md.status, 0, md.stderr);
    assert.match(md.stdout, /# Manifest Map/);
    const json = runViaRunner(dir, ['--format', 'json']);
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).schemaVersion, 1);
  });

  test('reverse (ext: selector) and cycles run through the runner', () => {
    const rev = runViaRunner(dir, ['--format', 'json', '--reverse', 'ext:node:express']);
    assert.equal(rev.status, 0, rev.stderr);
    assert.deepEqual(JSON.parse(rev.stdout).query.results.map(e => e.from), ['ws:node:.']);
    const cyc = runViaRunner(dir, ['--format', 'json', '--cycles']);
    assert.equal(cyc.status, 0, cyc.stderr);
    assert.deepEqual(JSON.parse(cyc.stdout).query.results[0].nodes,
      ['ws:node:.', 'ws:node:pkgs/cyc-a']);
  });

  test('--include-candidates changes resolution behavior through the runner', () => {
    const base = runViaRunner(dir, ['--format', 'json']);
    assert.equal(base.status, 0, base.stderr);
    const baseEnv = JSON.parse(base.stdout);
    const u = baseEnv.artifact.unresolvedDeclarations.find(x => x.requested.name === 'extra-pkg');
    assert.equal(u.reason, 'unverified_workspace_match',
      'without the flag the candidate shadow blocks resolution');
    const inc = runViaRunner(dir, ['--format', 'json', '--include-candidates']);
    assert.equal(inc.status, 0, inc.stderr);
    const incEnv = JSON.parse(inc.stdout);
    assert.ok(incEnv.artifact.edges.some(e =>
      e.from === 'ws:node:.' && e.to === 'ws:node:examples/extra' && e.resolution === 'local'),
    'with the flag the same declaration resolves local');
    assert.ok(!incEnv.artifact.unresolvedDeclarations.some(x => x.requested.name === 'extra-pkg'));
  });

  test('ambiguous selector and invalid arguments exit 2 through the runner', () => {
    const amb = makeFixture({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['a/*', 'b/*'] }),
      'a/dup/package.json': JSON.stringify({ name: 'dup-pkg' }),
      'b/dup/package.json': JSON.stringify({ name: 'dup-pkg' }),
    });
    const r = runViaRunner(amb, ['--reverse', 'dup-pkg']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ambiguous selector/);
    assert.equal(runViaRunner(dir, ['--format', 'xml']).status, 2);
    assert.equal(runViaRunner(dir, ['--reverse', 'x', '--cycles']).status, 2);
  });
});

// ---------------------------------------------------------------------------
// Regression: code-review round 1 fixes (parser fail-closed gaps, budget
// semantics, containment, projection escaping, deterministic ordering)
// ---------------------------------------------------------------------------
describe('toml table-header frozen subset', () => {
  test('array-of-tables never acts as the single table it resembles', () => {
    const arr = mm.parseTomlManifest('[[dependencies]]\nserde = "1"\n', 'cargo');
    assert.deepEqual(arr.data.deps, [], 'no dependency evidence from an unsupported table form');
    assert.ok(arr.unsupported.some(u => u.construct === 'unsupported table form: [[dependencies]]'),
      'a dependency-context table form is recorded, not silently absorbed');
    const ctl = mm.parseTomlManifest('[[bin]]\nname = "x"\n', 'cargo');
    assert.deepEqual([ctl.data.deps, ctl.unsupported, ctl.data.packageName], [[], [], null],
      'an unrelated array table ([[bin]]) stays inert — and its keys never leak evidence');
  });

  test('an unrecognizable header still closes the previous section', () => {
    // [dependencies] → malformed header → dependency-looking KV: the stale
    // section must not keep absorbing keys, whatever shape the bad header has
    const forms = ['[[[bin]]]', '[bin', '[[bin]]]'];
    const results = forms.map(h => {
      const r = mm.parseTomlManifest(`[dependencies]\ngood = "1"\n${h}\nforged = "1"\n`, 'cargo');
      return [r.data.deps.map(d => d.name), r.unsupported.length > 0];
    });
    assert.deepEqual(results, forms.map(() => [['good'], true]),
      'unclosed / triple / extra-closing headers: good kept, forged never recorded, failure logged');
    const resumed = mm.parseTomlManifest(
      '[dependencies]\na = "1"\n[bin\nx = "1"\n[dependencies]\nb = "1"\n', 'cargo');
    assert.deepEqual(resumed.data.deps.map(d => d.name), ['a', 'b'],
      'positive control: the next well-formed supported header re-opens normally');
  });

  test('trailing junk cannot hide a relevant header from coverage marking', () => {
    // the sentinel already blocks forged evidence; this pins the OTHER half of
    // the contract — the failure must reach coverage, not stay silent
    const dep = mm.parseTomlManifest('[package]\nname = "app"\n[dependencies] junk\nforged = "1"\n', 'cargo');
    assert.deepEqual(dep.data.deps, [], 'forged is never recorded');
    assert.deepEqual(dep.unsupported.map(u => u.construct), ['unsupported table form: [dependencies] junk'],
      'the first bracket payload identifies the relevant context despite the junk');
    const pkg = mm.parseTomlManifest('[package] junk\nname = "x"\n', 'cargo');
    assert.deepEqual([pkg.data.hasPackage, pkg.data.packageName, pkg.unsupported.length], [false, null, 1]);
    const proj = mm.parseTomlManifest('[project] junk\nname = "x"\n', 'pyproject');
    assert.deepEqual([proj.data.hasProject, proj.unsupported.length], [false, 1]);
    const inert = mm.parseTomlManifest('[tool.ruff] junk\nline-length = 88\n', 'pyproject');
    assert.deepEqual(inert.unsupported, [],
      'an unrelated malformed header stays inert — but still closes the section');
  });

  test('an empty header name is outside the frozen forms', () => {
    const r = mm.parseTomlManifest('[dependencies]\ngood = "1"\n[]\nforged = "1"\n', 'cargo');
    assert.deepEqual(r.data.deps.map(d => d.name), ['good'], 'forged is never recorded after []');
    assert.deepEqual(r.unsupported.map(u => u.construct), ['unsupported table form: []'],
      'the stale dependencies context makes the failure reach coverage');
  });

  test('a double-quoted key with an escaped quote does not end the header early', () => {
    const r = mm.parseTomlManifest('[dependencies]\ngood = "1"\n[tool."x\\"]".ruff]\nforged = "1"\n', 'cargo');
    assert.deepEqual([r.data.deps.map(d => d.name), r.unsupported], [['good'], []],
      'the escaped quote is data — the header closes at its real bracket, and the unrelated tool section stays inert');
  });

  test('a legal ] inside a quoted cfg string does not end the header', () => {
    const good = mm.parseTomlManifest(
      `[target.'cfg(target_env = "]")'.dependencies]\nserde = "1"\n`, 'cargo');
    assert.deepEqual([good.data.deps.map(d => d.name), good.unsupported], [['serde'], []],
      'legal TOML in the §3.5 frozen subset: the quoted ] is data, the header still opens');
    const junk = mm.parseTomlManifest(
      `[target.'cfg(target_env = "]")'.dependencies] junk\nserde = "1"\n`, 'cargo');
    assert.deepEqual(junk.data.deps, [], 'the trailing-junk variant stays fail-closed');
    assert.deepEqual(junk.unsupported.map(u => u.construct.startsWith('unsupported table form:')), [true],
      'and the quote-aware payload still identifies the relevant context despite the junk');
  });

  test('mismatched bracket headers fail closed instead of opening the section', () => {
    const mis = mm.parseTomlManifest('[package]]\nname = "x"\n', 'cargo');
    assert.deepEqual([mis.data.hasPackage, mis.data.packageName], [false, null],
      'malformed [package]] must not commit package evidence');
    assert.ok(mis.unsupported.some(u => u.construct === 'unsupported table form: [package]]'));
    const good = mm.parseTomlManifest('[package]\nname = "x"\n', 'cargo');
    assert.deepEqual([good.data.hasPackage, good.data.packageName], [true, 'x'],
      'positive control: the balanced single-bracket header still works');
  });
});

describe('go token frozen subset', () => {
  test('quoted require/module tokens decode — never kept verbatim with quotes', () => {
    const q = mm.parseGoFile('module "example.com/m"\nrequire "example.com/lib" v1.0.0\n', 'go.mod');
    assert.equal(q.data.module, 'example.com/m', 'the decoded name, not "example.com/m" with quotes');
    assert.deepEqual(q.data.requires.map(r => [r.module, r.version]),
      [['example.com/lib', 'v1.0.0']]);
    assert.equal(q.unsupported.length, 0);
  });

  test('malformed require/module tokens fail closed as unsupported', () => {
    const probes = [
      'require example.com/lib "v1\n',
      "require 'example.com/lib' v1.0.0\n",
      'require example.com/(lib) v1.0.0\n',
      `module ex${String.fromCharCode(0x85)}ample.com/m\n`,
    ];
    const results = probes.map(l => {
      const r = mm.parseGoFile(`${l}`, 'go.mod');
      return [r.data.module, r.data.requires.length, r.unsupported.length];
    });
    assert.deepEqual(results, probes.map(() => [null, 0, 1]),
      'unclosed quote / wrong quote form / lexer punctuation / non-printable: no record, one unsupported each');
  });

  test('block require and replace version slots go through the recognizer too', () => {
    const q = mm.parseGoFile(
      'module m\nrequire (\n\t"example.com/lib" "v1.0.0"\n)\nreplace old.com/a "v1.2.3" => new.com/b "v2.0.0"\n',
      'go.mod');
    assert.deepEqual(q.data.requires.map(r => [r.module, r.version]),
      [['example.com/lib', 'v1.0.0']], 'quoted BLOCK tokens decode — a separate parser branch');
    assert.deepEqual(q.data.replaces.map(r => [r.oldModule, r.oldVersion, r.targetKind]),
      [['old.com/a', 'v1.2.3', 'module']], 'quoted replace old-version decodes; quoted target version validates');
    assert.equal(q.unsupported.length, 0);
    const bad = mm.parseGoFile('module m\nrequire (\n\t"example.com/x v1.0.0\n)\n', 'go.mod');
    assert.deepEqual(bad.data.requires, [], 'a malformed block token mints no declaration');
    assert.deepEqual(bad.unsupported, [{ line: 3, construct: 'require entry: "example.com/x v1.0.0' }],
      'the diagnostic carries the ENTRY line and the raw text, not the block opener');
    const badv = mm.parseGoFile('module m\nreplace old.com/a `v1` => ./x\n', 'go.mod');
    assert.deepEqual([badv.data.replaces, badv.unsupported.length], [[], 1],
      'a malformed old-version slot fails the whole replace record closed');
  });

  test('the replace target-version slot is validated, not just discarded', () => {
    // the artifact drops the target version, so only a NEGATIVE case can prove
    // the last token position actually runs through the recognizer
    const bad = mm.parseGoFile('module m\nreplace old.com/a v1.0.0 => new.com/b `v2`\n', 'go.mod');
    assert.deepEqual(bad.data.replaces, [], 'a malformed FINAL token fails the whole record closed');
    assert.deepEqual(bad.unsupported.map(u => [u.line, u.construct.startsWith('replace:')]), [[2, true]]);
    const good = mm.parseGoFile('module m\nreplace old.com/a v1.0.0 => new.com/b v2.0.0\n', 'go.mod');
    assert.deepEqual(good.data.replaces.map(r => [r.oldModule, r.oldVersion, r.targetKind]),
      [['old.com/a', 'v1.0.0', 'module']],
      'positive control: the same shape with a valid version still records');
    assert.equal(good.unsupported.length, 0);
  });

  test('the go token failure boundary matches the use-operand conventions', () => {
    const probes = [
      'module ""\n',
      'require "" v1.0.0\n',
      'module "a\\tb"\n',
      `module ex${String.fromCharCode(0x200b)}ample\n`,
      `module a${String.fromCharCode(0xd800)}b\n`,
    ];
    const results = probes.map(l => {
      const r = mm.parseGoFile(`${l}`, 'go.mod');
      return [r.data.module, r.data.requires.length, r.unsupported.length];
    });
    assert.deepEqual(results, probes.map(() => [null, 0, 1]),
      'empty quoted / escape-bearing / Cf / lone-surrogate tokens: no record, one unsupported each');
  });

  test('replace clause tokens go through the same recognizer', () => {
    const q = mm.parseGoFile('module m\nreplace "old.com/a" => "./x"\n', 'go.mod');
    assert.deepEqual(q.data.replaces.map(r => [r.oldModule, r.targetKind, r.targetPath]),
      [['old.com/a', 'path', './x']],
      'decoded quoted target is still recognized as a path target');
    const bad = mm.parseGoFile('module m\nreplace "old.com/a => ./x\n', 'go.mod');
    assert.deepEqual(bad.data.replaces, []);
    assert.ok(bad.unsupported.some(u => u.construct.startsWith('replace:')),
      'an unclosed quote in the clause fails the whole record closed');
  });
});

describe('cargo inline table fail-closed boundaries', () => {
  test('unterminated inline table → unsupported, zero deps recorded', () => {
    const r = mm.parseTomlManifest([
      '[package]', 'name = "a"',
      '[dependencies]',
      'serde = { version = "1",',
      'tokio = "1.0"',
    ].join('\n'), 'cargo');
    assert.equal(r.data.deps.some(d => d.name === 'serde'), false);
    assert.ok(r.unsupported.some(u => u.construct === 'dependency inline table unterminated: serde'));
    assert.equal(r.data.deps.filter(d => d.name === 'tokio').length, 1, 'later entries unaffected');
  });

  test('wrong-typed recognized fields → unsupported, no field guessing', () => {
    const r = mm.parseTomlManifest([
      '[package]', 'name = "a"',
      '[dependencies]',
      'x = { version = true }',
      'y = { optional = "yes" }',
      'z = { workspace = true }',
    ].join('\n'), 'cargo');
    assert.equal(r.data.deps.some(d => d.name === 'x'), false);
    assert.equal(r.data.deps.some(d => d.name === 'y'), false);
    assert.ok(r.unsupported.some(u => u.construct.includes("'version' has non-string")));
    assert.ok(r.unsupported.some(u => u.construct.includes("'optional' has non-boolean")));
    assert.equal(r.data.deps.filter(d => d.name === 'z').length, 1, 'valid table control');
  });
});

describe('go block EOF and exclude/retract handling', () => {
  test('unterminated require block at EOF → entries rolled back + unsupported', () => {
    const r = mm.parseGoFile([
      'module example.com/m',
      'require (',
      '\texample.com/a v1.0.0',
      '\texample.com/b v2.0.0',
    ].join('\n'), 'go.mod');
    assert.equal(r.data.requires.length, 0, 'partial block entries are not trusted');
    assert.deepEqual(r.unsupported.map(u => [u.line, u.construct]),
      [[2, 'unterminated require block']]);
  });

  test('unterminated replace block at EOF → replaces rolled back, prior requires survive', () => {
    const r = mm.parseGoFile([
      'module example.com/m',
      'require example.com/a v1.0.0',
      'replace (',
      '\texample.com/a => ../local',
    ].join('\n'), 'go.mod');
    assert.deepEqual(r.data.replaces, [], 'partial replace entries are not trusted');
    assert.deepEqual(r.data.requires.map(q => q.module), ['example.com/a'],
      'entries before the block are a complete record and survive the rollback');
    assert.deepEqual(r.unsupported.map(u => [u.line, u.construct]),
      [[3, 'unterminated replace block']]);
  });

  test('unterminated use block at EOF → uses rolled back + unsupported', () => {
    const r = mm.parseGoFile([
      'go 1.22',
      'use (',
      '\t./modA',
    ].join('\n'), 'go.work');
    assert.deepEqual(r.data.uses, [], 'partial use entries never become membership evidence');
    assert.deepEqual(r.unsupported.map(u => [u.line, u.construct]),
      [[2, 'unterminated use block']]);
  });

  test('terminated block control + exclude entries never become use paths', () => {
    const r = mm.parseGoFile([
      'module example.com/m',
      'require (', '\texample.com/a v1.0.0', ')',
      'exclude (', '\texample.com/evil v0.1.0', ')',
    ].join('\n'), 'go.mod');
    assert.equal(r.data.requires.length, 1, 'closed block keeps entries');
    assert.deepEqual(r.data.uses, [], 'exclude entries carry no membership meaning');
    assert.equal(r.unsupported.length, 0, 'exclude/retract are legal go.mod syntax');
  });

  test('cross-kind directives are unsupported per the §3.5 parser matrix', () => {
    const work = mm.parseGoFile([
      'go 1.22',
      'module example.com/w',
      'require example.com/a v1.0.0',
      'exclude example.com/b v1.0.0',
      'use ./modA',
    ].join('\n'), 'go.work');
    assert.equal(work.data.module, null, 'go.work must not extract module');
    assert.deepEqual(work.data.requires, [], 'go.work must not extract require');
    assert.deepEqual(work.data.uses.map(u => u.path), ['./modA'], 'use control still extracted');
    assert.deepEqual(work.unsupported.map(u => u.line), [2, 3, 4], 'each foreign directive recorded');
    const mod = mm.parseGoFile('module example.com/m\nuse ./sub\n', 'go.mod');
    assert.deepEqual(mod.data.uses, [], 'go.mod must not extract use');
    assert.equal(mod.unsupported.length, 1);
  });

  test('go.work require block is consumed without extraction', () => {
    const r = mm.parseGoFile([
      'go 1.22',
      'require (', '\texample.com/a v1.0.0', ')',
      'use ./modA',
    ].join('\n'), 'go.work');
    assert.deepEqual(r.data.requires, [], 'block entries never extracted cross-kind');
    assert.deepEqual(r.unsupported, [{ line: 2, construct: 'go.work directive: require block' }]);
    assert.deepEqual(r.data.uses.map(u => u.path), ['./modA'], 'directives after the block unaffected');
  });
});

describe('quote-aware TOML string arrays', () => {
  test('python: quoted comma stays one dep; markers reject; per-item lines', () => {
    const r = mm.parseTomlManifest([
      '[project]',                                  // line 1
      'name = "app"',                               // line 2
      'dependencies = [',                           // line 3
      '  "requests>=2,<3",',                        // line 4
      '  "foo[a,b]>=1",',                           // line 5
      '  "gated>=1; python_version<\'3.11\'",',     // line 6
      ']',
    ].join('\n'), 'pyproject');
    assert.deepEqual(r.data.pyDeps.map(d => [d.raw, d.line]), [
      ['requests>=2,<3', 4], ['foo[a,b]>=1', 5], ["gated>=1; python_version<'3.11'", 6],
    ]);
    assert.equal(mm.extractPyDepName('requests>=2,<3').ok, true);
    assert.equal(mm.extractPyDepName('foo[a,b]>=1').ok, true);
    assert.equal(mm.extractPyDepName("gated>=1; python_version<'3.11'").ok, false,
      'environment marker → fail-closed');
  });

  test('cargo: multi-line members keep first-line items and quoted commas', () => {
    const r = mm.parseTomlManifest([
      '[workspace]',
      'members = ["crates/a",',
      '  "crates/b"]',
      'exclude = ["skip,me"]',
    ].join('\n'), 'cargo');
    assert.deepEqual(r.data.members.map(m => [m.value, m.line]),
      [['crates/a', 2], ['crates/b', 3]], 'first-line item survives the multi-line commit');
    assert.deepEqual(r.data.exclude.map(m => m.value), ['skip,me'],
      'quoted comma is data, not a separator');
    assert.equal(r.unsupported.length, 0);
  });
});

describe('python marker rejection at graph level', () => {
  test('marker dependency → partial coverage, zero edges, control dep resolves', () => {
    const dir = makeFixture({
      'pyproject.toml': [
        '[project]', 'name = "app"',
        'dependencies = ["plain>=1", "gated>=1; sys_platform == \'win32\'"]',
      ].join('\n'),
    });
    const env = mapJson(dir);
    const cov = env.artifact.coverage.find(c => c.manifest === 'pyproject.toml');
    assert.equal(cov.status, 'partial');
    assert.ok(cov.unsupported.some(u => u.construct.startsWith('unsupported dependency string: gated')));
    assert.ok(env.artifact.edges.some(e => e.to === 'ext:python:plain'), 'control: plain dep still resolves');
    assert.ok(!env.artifact.edges.some(e => String(e.to).includes('gated')), 'no guessed edge for the marker dep');
    assert.deepEqual(env.artifact.unresolvedDeclarations, [],
      '§3.3: unsupported syntax goes to coverage ONLY — zero edges AND zero unresolved');
  });
});

describe('cargo template package rename', () => {
  test('template `package` field is the real target identity', () => {
    const dir = makeFixture({
      'Cargo.toml': [
        '[workspace]', 'members = ["crates/*"]',
        '[workspace.dependencies]',
        'dep1 = { version = "1", package = "actual-crate" }',
      ].join('\n'),
      'crates/app/Cargo.toml': [
        '[package]', 'name = "app"',
        '[dependencies]', 'dep1 = { workspace = true }',
      ].join('\n'),
    });
    const env = mapJson(dir);
    const edge = env.artifact.edges.find(e => e.from === 'ws:rust:crates/app');
    assert.equal(edge.to, 'ext:rust:actual-crate', 'rename wins over the member key');
    assert.ok(!env.artifact.externals.some(x => x.name === 'dep1'));
  });
});

describe('go.work use corroboration binds to the used directory', () => {
  test('same module name elsewhere in corpus does not poison the use match', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse ./modA\n',
      'modA/go.mod': 'module example.com/dup\n',
      'copies/modA2/go.mod': 'module example.com/dup\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/dup v0.0.0\n',
    });
    const env = mapJson(dir);
    const edge = env.artifact.edges.find(e => e.from === 'ws:go:api' && e.resolution === 'local');
    assert.equal(edge.to, 'ws:go:modA', 'resolves to the USED dir, not ambiguous over the copy');
    assert.ok(!env.artifact.unresolvedDeclarations.some(u =>
      u.from === 'ws:go:api' && u.requested.name === 'example.com/dup'));
  });
});

describe('go unterminated blocks at graph level', () => {
  test('half a replace block never forges a local path resolution', () => {
    const dir = makeFixture({
      'api/go.mod': [
        'module example.com/api',
        'require example.com/a v1.0.0',
        'replace (',
        '\texample.com/a => ../local',
      ].join('\n'),
      'local/go.mod': 'module example.com/a\n',
    });
    const env = mapJson(dir);
    const cov = env.artifact.coverage.find(c => c.manifest === 'api/go.mod');
    assert.equal(cov.status, 'partial');
    assert.ok(cov.unsupported.some(u => u.construct === 'unterminated replace block'));
    assert.ok(!env.artifact.edges.some(e => e.from === 'ws:go:api' && e.resolution === 'local'),
      'the rolled-back replace must not redirect the require to a local path');
    const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'example.com/a');
    assert.equal(u.reason, 'unverified_workspace_match',
      'the require falls through to the in-corpus module identity check instead');
    assert.deepEqual(u.candidates, ['ws:go:local']);
  });

  describe('half a use block', () => {
    let env;
    before(() => {
      const dir = makeFixture({
        'go.work': 'go 1.22\nuse (\n\t./modA\n',
        'modA/go.mod': 'module example.com/dup\n',
        'copies/modA2/go.mod': 'module example.com/dup\n',
        'api/go.mod': 'module example.com/api\nrequire example.com/dup v0.0.0\n',
      });
      env = mapJson(dir);
    });

    test('controller and coverage record the incomplete member set', () => {
      const cov = env.artifact.coverage.find(c => c.manifest === 'go.work');
      assert.equal(cov.status, 'partial');
      assert.ok(cov.unsupported.some(u => u.construct === 'unterminated use block'));
      const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
      assert.deepEqual(ctl.members, [], 'rolled-back use entries confirm nothing');
      assert.equal(ctl.membershipStatus, 'partial',
        '§3.3: an empty set from a rolled-back block must not pose as parsed-and-empty');
    });

    test('the require falls to unverified_workspace_match, never local', () => {
      assert.ok(!env.artifact.edges.some(e => e.from === 'ws:go:api' && e.resolution === 'local'),
        'no use corroboration → the require must not resolve to a local edge');
      const u = env.artifact.unresolvedDeclarations.find(x => x.requested.name === 'example.com/dup');
      assert.equal(u.reason, 'unverified_workspace_match');
      assert.deepEqual(u.candidates, ['ws:go:copies/modA2', 'ws:go:modA'], 'both same-name copies listed');
    });
  });

  test('malformed use operands are membership failures; balanced quotes parse', () => {
    const bare = mm.parseGoFile('go 1.22\nuse\n', 'go.work');
    assert.deepEqual(bare.data.uses, []);
    assert.deepEqual(bare.unsupported.map(u => [u.line, u.construct]),
      [[2, 'use directive: missing operand']]);
    const multi = mm.parseGoFile('go 1.22\nuse ./a ./b\n', 'go.work');
    assert.deepEqual(multi.data.uses, [], 'two tokens are not one path');
    assert.deepEqual(multi.data.membershipUnsupported.map(u => [u.line, u.construct]),
      [[2, 'use: ./a ./b']], 'silently dropping the operand is not failing closed');
    const unclosed = mm.parseGoFile('go 1.22\nuse "./a\n', 'go.work');
    assert.deepEqual(unclosed.data.uses, [], 'an unclosed quote never yields a path');
    assert.deepEqual(unclosed.data.membershipUnsupported.map(u => [u.line, u.construct]),
      [[2, 'use: "./a']]);
    const quoted = mm.parseGoFile('go 1.22\nuse "./modA"\n', 'go.work');
    assert.deepEqual(quoted.data.uses.map(u => u.path), ['./modA'], 'balanced-quote control');
  });

  test('quote punctuation stays outside the frozen use-operand subset', () => {
    const probes = ['use `./a`', "use './a'", 'use ./a"b', 'use (./a)'];
    const results = probes.map(l => {
      const r = mm.parseGoFile(`go 1.22\n${l}\n`, 'go.work');
      return [l, r.data.uses.length, r.data.membershipUnsupported.length];
    });
    assert.deepEqual(results, probes.map(l => [l, 0, 1]),
      'backtick/single-quote/embedded-quote/paren forms: no path, one membership failure each');
  });

  test('double-quote escapes fail closed both ways; quoted whitespace is data', () => {
    const esc = mm.parseGoFile('go 1.22\nuse "./a\\x20b"\n', 'go.work');
    assert.deepEqual(esc.data.uses, [], 'a VALID escape is outside the frozen subset — no decode, no literal match');
    assert.deepEqual(esc.data.membershipUnsupported.map(u => u.line), [2]);
    const bad = mm.parseGoFile('go 1.22\nuse "\\q"\n', 'go.work');
    assert.deepEqual(bad.data.uses, [], 'an INVALID escape never parses either');
    assert.deepEqual(bad.data.membershipUnsupported.map(u => [u.line, u.construct]),
      [[2, 'use: "\\q"']], 'silently dropping it would not be failing closed');
    const sp = mm.parseGoFile('go 1.22\nuse "./my module"\n', 'go.work');
    assert.deepEqual(sp.data.uses.map(u => u.path), ['./my module'],
      'escape-free quoted whitespace is data — the subset still covers real quoting');
  });

  test('Go lexer punctuation and control chars stay outside the operand subset', () => {
    const esc = String.fromCharCode(0x1b);
    const probes = ['use ./a[b]', 'use ./a{b}', 'use ./a,b', `use ./a${esc}b`, 'use .\\mod'];
    const results = probes.map(l => {
      const r = mm.parseGoFile(`go 1.22\n${l}\n`, 'go.work');
      return [r.data.uses.length, r.data.membershipUnsupported.length];
    });
    assert.deepEqual(results, probes.map(() => [0, 1]),
      'bracket/brace/comma/control/backslash forms: no path, one membership failure each');
    const block = mm.parseGoFile('go 1.22\nuse (\n\t./a[b]\n)\n', 'go.work');
    assert.deepEqual(block.data.uses, []);
    assert.deepEqual(block.data.membershipUnsupported.map(u => [u.line, u.construct]),
      [[3, 'use entry: ./a[b]']], 'the block form fails closed the same way');
  });

  test('absolute and drive-qualified use operands stay outside the frozen subset', () => {
    const probes = ['use /abs', 'use C:/abs', 'use "/abs"'];
    const results = probes.map(l => {
      const r = mm.parseGoFile(`go 1.22\n${l}\n`, 'go.work');
      return [r.data.uses.length, r.data.membershipUnsupported.length];
    });
    assert.deepEqual(results, probes.map(() => [0, 1]),
      'legal Go but not controller-relative — each fails closed as a membership failure');
    const rel = mm.parseGoFile('go 1.22\nuse ./abs\n', 'go.work');
    assert.deepEqual(rel.data.uses.map(u => u.path), ['./abs'],
      'positive control: the same name as a relative path still parses');
  });

  test('Unicode non-printables stay outside the operand subset in both forms', () => {
    // NEL (Cc), ZERO WIDTH SPACE and WORD JOINER (Cf) all escape JS \s and the
    // C0/DEL ranges; Go's lexer rejects them via !unicode.IsPrint
    const probes = [0x85, 0x200b, 0x2060].map(cp => `use ./a${String.fromCharCode(cp)}b`);
    probes.push(`use "./a${String.fromCharCode(0x85)}b"`);
    const results = probes.map(l => {
      const r = mm.parseGoFile(`go 1.22\n${l}\n`, 'go.work');
      return [r.data.uses.length, r.data.membershipUnsupported.length];
    });
    assert.deepEqual(results, probes.map(() => [0, 1]),
      'bare NEL/ZWSP/WJ and quoted NEL: no path, one membership failure each');
    const cjk = mm.parseGoFile('go 1.22\nuse ./模組\n', 'go.work');
    assert.deepEqual(cjk.data.uses.map(u => u.path), ['./模組'],
      'positive control: printable Unicode letters are inside the subset');
  });

  test('every allowlisted Unicode category has a positive operand binding', () => {
    // M (combining mark — macOS NFD filenames), N (digit), S (symbol, incl.
    // an astral pair); L, P and quoted ASCII space are bound by other tests
    const probes = [
      './module2',
      `./cafe${String.fromCharCode(0x301)}`,
      './c++',
      `./${String.fromCodePoint(0x1f600)}`,
    ];
    const results = probes.map(op => {
      const r = mm.parseGoFile(`go 1.22\nuse ${op}\n`, 'go.work');
      return [r.data.uses.length, r.data.membershipUnsupported.length];
    });
    assert.deepEqual(results, probes.map(() => [1, 0]),
      'digits, combining marks, symbols and astral pairs are all inside the subset');
    const lone = mm.parseGoFile(`go 1.22\nuse ./a${String.fromCharCode(0xd800)}b\n`, 'go.work');
    assert.deepEqual([lone.data.uses.length, lone.data.membershipUnsupported.length], [0, 1],
      'a lone surrogate matches no printable category and fails closed');
  });

  test('the quoted empty operand is outside the frozen subset', () => {
    const r = mm.parseGoFile('go 1.22\nuse ""\n', 'go.work');
    assert.deepEqual(r.data.uses, [],
      'an empty path must not alias `use .` by path.join coincidence');
    assert.deepEqual(r.data.membershipUnsupported.map(u => [u.line, u.construct]),
      [[2, 'use: ""']]);
  });

  test('// inside a quoted use path is data; a trailing comment still strips', () => {
    const r = mm.parseGoFile('go 1.22\nuse "./a//b" // note\n', 'go.work');
    assert.deepEqual(r.data.uses.map(u => u.path), ['./a//b'],
      'the quoted // is path data; the real trailing comment is gone');
    assert.equal(r.unsupported.length, 0);
  });

  test('terminated block: malformed entry recorded, good entry kept', () => {
    const r = mm.parseGoFile('go 1.22\nuse (\n\t./good\n\t./a ./b\n)\n', 'go.work');
    assert.deepEqual(r.data.uses.map(u => [u.path, u.line]), [['./good', 3]]);
    assert.deepEqual(r.data.membershipUnsupported.map(u => [u.line, u.construct]),
      [[4, 'use entry: ./a ./b']]);
    assert.deepEqual(r.unsupported.map(u => [u.line, u.construct]),
      [[4, 'use entry: ./a ./b']], 'the entry is in both records, nothing else is');
  });

  test('unclosed-quote use cannot confirm a member or corroborate a require', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse "./modA\n',
      'modA/go.mod': 'module example.com/dup\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/dup v0.0.0\n',
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.work').status, 'partial');
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial');
    assert.deepEqual(ctl.members, [], 'illegal syntax must not confirm a member');
    assert.equal(env.artifact.workspaces.find(w => w.manifest === 'modA/go.mod').role,
      'candidate_workspace');
    assert.ok(!env.artifact.edges.some(e => e.from === 'ws:go:api' && e.resolution === 'local'),
      '§6: malformed syntax must not provide local corroboration');
  });

  test('operand-less use → controller partial with diagnostic, zero members', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse\n',
      'modA/go.mod': 'module example.com/a\n',
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.work').status, 'partial');
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial');
    assert.deepEqual(ctl.diagnostics, [{ construct: 'use directive: missing operand', value: 'line 2' }]);
    assert.deepEqual(ctl.members, []);
  });

  test('terminated block with a malformed entry keeps good, fails the bad closed', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse (\n\t./good\n\t./a ./b\n)\n',
      'good/go.mod': 'module example.com/good\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/good v0.0.0\n',
    });
    const env = mapJson(dir);
    const cov = env.artifact.coverage.find(c => c.manifest === 'go.work');
    assert.equal(cov.status, 'partial');
    assert.ok(cov.unsupported.some(u => u.line === 4 && u.construct === 'use entry: ./a ./b'));
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial');
    assert.deepEqual(ctl.members, ['ws:go:good'], 'the well-formed entry still confirms');
    assert.equal(env.artifact.workspaces.find(w => w.manifest === 'good/go.mod').role,
      'confirmed_workspace');
  });

  test('membership-unrelated foreign directive leaves membership parsed', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nmodule example.com/w\nuse ./modA\n',
      'modA/go.mod': 'module example.com/a\n',
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.work').status, 'partial',
      'the foreign directive still costs coverage');
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'parsed', 'membership completeness is untouched');
    assert.deepEqual(ctl.diagnostics, []);
    assert.deepEqual(ctl.members, ['ws:go:modA']);
    assert.equal(env.artifact.workspaces.find(w => w.manifest === 'modA/go.mod').role,
      'confirmed_workspace');
  });

  test('partial use block → controller partial with diagnostics, proven members kept', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse ./good\nuse (\n\t./bad\n',
      'good/go.mod': 'module example.com/good\n',
      'bad/go.mod': 'module example.com/bad\n',
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.work').status, 'partial');
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial', 'an incomplete member set must not pose as complete');
    assert.deepEqual(ctl.diagnostics, [{ construct: 'unterminated use block', value: 'line 3' }]);
    assert.deepEqual(ctl.members, ['ws:go:good'], 'the member proven before the block survives');
    assert.equal(env.artifact.workspaces.find(w => w.manifest === 'good/go.mod').role,
      'confirmed_workspace');
    assert.equal(env.artifact.workspaces.find(w => w.manifest === 'bad/go.mod').role,
      'candidate_workspace', 'the rolled-back use never confirms its member');
  });
});

describe('go.work literal path membership', () => {
  test('a * is never expanded as a glob — unquoted is malformed Go, quoted is a literal non-match', () => {
    // dual control on the same fixture: `use ./modules/*` bare is malformed Go
    // (the lexer rejects /* as a block-comment opener) → membership failure,
    // while `use "./modules/*"` is a legal quoted literal that matches nothing
    // → provable non-match. Neither form may expand into modules/a, modules/b.
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse ./modules/*\nuse "./modules/*"\n',
      'modules/a/go.mod': 'module example.com/a\n',
      'modules/b/go.mod': 'module example.com/b\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial', 'the malformed bare form makes the member set unprovable');
    assert.deepEqual(ctl.members, [], 'no wildcard expansion for either form');
    assert.deepEqual(ctl.diagnostics, [
      { construct: 'unmatched member pattern', value: 'modules/*' },
      { construct: 'use: ./modules/*', value: 'line 2' },
    ]);
    assert.deepEqual(
      Object.fromEntries(env.artifact.workspaces
        .filter(w => w.id.startsWith('ws:go:modules/'))
        .map(w => [w.id, w.role])),
      { 'ws:go:modules/a': 'candidate_workspace', 'ws:go:modules/b': 'candidate_workspace' },
    );
  });

  test('punctuation operand with a real same-named directory stays fail-closed', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse ./a[b]\n',
      'a[b]/go.mod': 'module example.com/br\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/br v0.0.0\n',
    });
    const env = mapJson(dir);
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.work').status, 'partial');
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial');
    assert.deepEqual(ctl.members, [], 'rejected syntax must not confirm the matching directory');
    assert.equal(env.artifact.workspaces.find(w => w.manifest === 'a[b]/go.mod').role,
      'candidate_workspace');
    assert.ok(!env.artifact.edges.some(e => e.from === 'ws:go:api' && e.resolution === 'local'),
      '§6: the rejected operand must not corroborate a local edge either');
  });

  test('use . confirms the go.mod sharing the go.work directory', () => {
    const dir = makeFixture({
      'w/go.work': 'go 1.22\nuse .\n',
      'w/go.mod': 'module example.com/w\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'parsed');
    assert.deepEqual(ctl.diagnostics, []);
    assert.deepEqual(ctl.members, ['ws:go:w'], 'the same-directory module is a legal member');
    assert.equal(env.artifact.workspaces.find(w => w.id === 'ws:go:w').role, 'confirmed_workspace');
  });

  test('normalized use path: controller membership and corroboration agree', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse ./a/../b\n',
      'b/go.mod': 'module example.com/b\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/b v0.0.0\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'parsed');
    assert.deepEqual(ctl.diagnostics, [], 'a fully resolved use list carries no diagnostics');
    assert.deepEqual(ctl.members, ['ws:go:b'], 'the literal path is normalized, then matched');
    assert.equal(env.artifact.workspaces.find(w => w.id === 'ws:go:b').role, 'confirmed_workspace');
    const edge = env.artifact.edges.find(e => e.from === 'ws:go:api' && e.resolution === 'local');
    assert.equal(edge.to, 'ws:go:b',
      '§3.4: corroboration and membership derive from the same resolution — no split-brain');
  });

  test('quoted // path resolves to its normalized directory at graph level', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse "./a//b"\n',
      'a/b/go.mod': 'module example.com/ab\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'parsed');
    assert.deepEqual(ctl.members, ['ws:go:a/b'], 'quote-aware comment keeps the path whole');
  });

  test('an absolute use never confirms a same-named directory inside the corpus', () => {
    const dir = makeFixture({
      'w/go.work': 'go 1.22\nuse /abs\n',
      'w/abs/go.mod': 'module example.com/abs\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/abs v0.0.0\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial', 'the operand is legal Go, so the set is unprovable');
    assert.deepEqual(ctl.members, [], '/abs must not be joined as controller-relative w/abs');
    assert.equal(env.artifact.workspaces.find(w => w.manifest === 'w/abs/go.mod').role,
      'candidate_workspace');
    assert.ok(!env.artifact.edges.some(e => e.from === 'ws:go:api' && e.resolution === 'local'),
      'the rejected operand must not corroborate a local edge either');
  });

  test('positive control: the same directory reached by a relative use is confirmed', () => {
    const dir = makeFixture({
      'w/go.work': 'go 1.22\nuse ./abs\n',
      'w/abs/go.mod': 'module example.com/abs\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'parsed');
    assert.deepEqual(ctl.members, ['ws:go:w/abs']);
  });

  test('a non-printable byte in a use operand never confirms a matching directory', () => {
    const name = `a${String.fromCharCode(0x85)}b`;
    const dir = makeFixture({
      'go.work': `go 1.22\nuse ./${name}\n`,
      [`${name}/go.mod`]: 'module example.com/nel\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/nel v0.0.0\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial');
    assert.deepEqual(ctl.members, [], 'the malformed operand must not confirm the real directory');
    assert.equal(env.artifact.workspaces.find(w => w.manifest === `${name}/go.mod`).role,
      'candidate_workspace');
    assert.ok(!env.artifact.edges.some(e => e.from === 'ws:go:api' && e.resolution === 'local'),
      'no corroborated local edge from rejected syntax');
  });

  test('an astral-symbol directory round-trips membership and corroboration', () => {
    const name = String.fromCodePoint(0x1f600);
    const dir = makeFixture({
      'go.work': `go 1.22\nuse ./${name}\n`,
      [`${name}/go.mod`]: 'module example.com/emoji\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/emoji v0.0.0\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'parsed');
    assert.deepEqual(ctl.members, [`ws:go:${name}`],
      'the original string survives enumeration, normalization and exact lookup');
    assert.equal(env.artifact.workspaces.find(w => w.id === `ws:go:${name}`).role,
      'confirmed_workspace');
    const edge = env.artifact.edges.find(e => e.from === 'ws:go:api' && e.resolution === 'local');
    assert.equal(edge && edge.to, `ws:go:${name}`,
      'membership and corroboration agree on the astral name');
  });

  test('use "" fails closed instead of aliasing the controller directory', () => {
    const dir = makeFixture({
      'w/go.work': 'go 1.22\nuse ""\n',
      'w/go.mod': 'module example.com/w\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/w v0.0.0\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial');
    assert.deepEqual(ctl.members, [], 'the empty operand must not resolve to the go.work directory');
    assert.equal(env.artifact.workspaces.find(w => w.manifest === 'w/go.mod').role,
      'candidate_workspace');
    assert.ok(!env.artifact.edges.some(e => e.from === 'ws:go:api' && e.resolution === 'local'),
      'no corroborated local edge either — `use .` is the supported spelling');
  });

  test('a use escaping the corpus is a membership failure, not a provable non-match', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse ../outside\n',
      'go.mod': 'module example.com/root\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/root v0.0.0\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'partial', 'the member set is unprovable from the scanned corpus');
    assert.deepEqual(ctl.members, [], 'partial must not still confirm the controller-directory go.mod');
    assert.deepEqual(ctl.diagnostics, [{ construct: 'use outside corpus', value: '../outside' }]);
    assert.equal(env.artifact.coverage.find(c => c.manifest === 'go.work').status, 'partial');
    assert.ok(!env.artifact.edges.some(e => e.from === 'ws:go:api' && e.resolution === 'local'),
      'an unconfirmed member never corroborates a local edge');
    const nested = makeFixture({
      'w/go.work': 'go 1.22\nuse ../../x\nuse ../sib\n',
      'sib/go.mod': 'module example.com/sib\n',
    });
    const ctl2 = mapJson(nested).artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl2.membershipStatus, 'partial', '../../x normalizes out of the corpus');
    assert.deepEqual(ctl2.members, ['ws:go:sib'],
      'positive control: a ../ that stays inside the corpus still confirms');
  });

  test('a directory literally named ..cache is inside the corpus, not a parent escape', () => {
    const dir = makeFixture({
      'go.work': 'go 1.22\nuse ./..cache\n',
      '..cache/go.mod': 'module example.com/cache\n',
      'api/go.mod': 'module example.com/api\nrequire example.com/cache v0.0.0\n',
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'go_work');
    assert.equal(ctl.membershipStatus, 'parsed');
    assert.deepEqual(ctl.members, ['ws:go:..cache'], 'startsWith("..") alone must not reject it');
    assert.equal(env.artifact.workspaces.find(w => w.id === 'ws:go:..cache').role,
      'confirmed_workspace');
    const edge = env.artifact.edges.find(e => e.from === 'ws:go:api' && e.resolution === 'local');
    assert.equal(edge && edge.to, 'ws:go:..cache',
      'membership and corroboration agree on the ..-prefixed name');
  });
});

describe('markdown projection architectural scoping', () => {
  test('local Top-N shows only edges whose BOTH endpoints are architecture nodes', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'root', dependencies: { demo: 'file:./examples/demo' } }),
      'examples/demo/package.json': JSON.stringify({ name: 'demo' }),
    });
    const env = mapJson(dir);
    assert.ok(env.artifact.edges.some(e => e.to === 'ws:node:examples/demo' && e.resolution === 'local'),
      'the JSON artifact keeps the full edge');
    const md = runMap(dir, []);
    assert.equal(md.status, 0, md.stderr);
    const localSection = md.stdout.slice(md.stdout.indexOf('Local 宣告邊'));
    assert.ok(!localSection.includes('examples/demo'),
      'a candidate endpoint is excluded from the default overview');
    const inc = runMap(dir, ['--include-candidates']);
    const incSection = inc.stdout.slice(inc.stdout.indexOf('Local 宣告邊'));
    assert.ok(incSection.includes('examples/demo'),
      '--include-candidates is the widening path, as §3.4 states');
  });
});

describe('reverse query architectural scoping', () => {
  test('candidate-source edges are excluded by default, included with the flag', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'root', dependencies: { lodash: '^4.0.0' } }),
      'orphan/package.json': JSON.stringify({ name: 'orphan', dependencies: { lodash: '^4.0.0' } }),
    });
    const base = mapJson(dir, ['--reverse', 'ext:node:lodash']);
    assert.deepEqual(base.query.results.map(e => e.from), ['ws:node:.'],
      'unconfirmed candidate must not appear in the default reverse view');
    const inc = mapJson(dir, ['--reverse', 'ext:node:lodash', '--include-candidates']);
    assert.deepEqual(inc.query.results.map(e => e.from), ['ws:node:.', 'ws:node:orphan']);
  });
});

describe('combined manifest budget population', () => {
  test('detection-only files consume the same 500 budget as parse targets', () => {
    const files = {};
    // 498 detection-only lockfiles sort before mods/: they consume the budget
    for (let i = 1; i <= 498; i++) {
      files[`locks/l${String(i).padStart(3, '0')}/go.sum`] = 'x';
    }
    for (let i = 1; i <= 5; i++) {
      files[`mods/m${i}/package.json`] = JSON.stringify({ name: `m${i}` });
    }
    const dir = makeFixture(files);
    const env = mapJson(dir);
    const om = env.artifact.omissions.find(o => o.reason === 'manifest_budget');
    assert.equal(om.count, 3, '498 + 5 = 503 → 3 dropped from the sorted tail');
    assert.deepEqual(om.sample, ['mods/m3/package.json', 'mods/m4/package.json', 'mods/m5/package.json']);
    assert.deepEqual(env.artifact.workspaces.map(w => w.manifest),
      ['mods/m1/package.json', 'mods/m2/package.json']);
    assert.equal(env.artifact.coverage.filter(c => c.status === 'unrecognized').length, 498);
  });

  test('controllers consume the same budget: dropped ones leave no record', () => {
    const files = {
      // sorts first (a < l) — inside the 500 slice, must survive as a controller
      'apps/pnpm-workspace.yaml': 'packages:\n  - "x/*"\n',
      // sorts last (p > m) — past the slice, must leave no controller record
      'pnpm-workspace.yaml': 'packages:\n  - "y/*"\n',
    };
    for (let i = 1; i <= 498; i++) {
      files[`locks/l${String(i).padStart(3, '0')}/go.sum`] = 'x';
    }
    for (let i = 1; i <= 5; i++) {
      files[`mods/m${i}/package.json`] = JSON.stringify({ name: `m${i}` });
    }
    const dir = makeFixture(files);
    const env = mapJson(dir);
    const om = env.artifact.omissions.find(o => o.reason === 'manifest_budget');
    assert.equal(om.count, 5, '1 + 498 + 5 + 1 = 505 → 5 dropped from the sorted tail');
    assert.deepEqual(om.sample, [
      'mods/m2/package.json', 'mods/m3/package.json', 'mods/m4/package.json',
      'mods/m5/package.json', 'pnpm-workspace.yaml',
    ], 'the dropped tail includes the late-sorting controller');
    assert.deepEqual(env.artifact.controllers.map(c => c.manifest), ['apps/pnpm-workspace.yaml'],
      'kept controller has a record; the dropped one has none');
    assert.ok(!env.artifact.coverage.some(c => c.manifest === 'pnpm-workspace.yaml'),
      'a budget-dropped controller gets no coverage entry either');
  });
});

describe('corpus symlink containment', () => {
  test('symlinked manifest escaping the root is never parsed', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mmap-out-'));
    tmpDirs.push(outside);
    fs.writeFileSync(path.join(outside, 'package.json'),
      JSON.stringify({ name: 'evil', dependencies: { leaked: '*' } }));
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'app' }),
    });
    // git corpus: `ls-files --others` lists the untracked symlink, which is the
    // enumeration path that can surface an escaping manifest (walkFiles skips
    // symlinks entirely — conservative, no record)
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.symlinkSync(path.join(outside, 'package.json'), path.join(dir, 'sub', 'package.json'));
    const env = mapJson(dir);
    const cov = env.artifact.coverage.find(c => c.manifest === 'sub/package.json');
    assert.equal(cov.status, 'skipped');
    assert.equal(cov.reason, 'unreadable', 'reason stays inside the §3.3 coverage union');
    assert.ok(env.artifact.diagnostics.some(d =>
      d.code === 'manifest_outside_corpus' && d.manifest === 'sub/package.json'),
    'the containment cause is preserved as a diagnostic');
    assert.ok(!env.artifact.workspaces.some(w => w.name === 'evil'), 'escaped content never becomes a node');
    assert.ok(!env.artifact.edges.some(e => String(e.to).includes('leaked')));
  });

  test('in-root symlinked manifest still parses — the fence rejects escapes, not symlinks', () => {
    const dir = makeFixture({
      'real/package.json': JSON.stringify({ name: 'realpkg' }),
    });
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.mkdirSync(path.join(dir, 'link'));
    fs.symlinkSync(path.join('..', 'real', 'package.json'), path.join(dir, 'link', 'package.json'));
    const env = mapJson(dir);
    const cov = env.artifact.coverage.find(c => c.manifest === 'link/package.json');
    assert.equal(cov.status, 'parsed', 'realpath stays inside the corpus → normal parse');
    assert.ok(env.artifact.workspaces.some(w => w.manifest === 'link/package.json'),
      'the symlinked manifest becomes a node like any other');
    assert.ok(!env.artifact.diagnostics.some(d => d.code === 'manifest_outside_corpus'),
      'no containment diagnostic for an in-root target');
  });

  test('escaping manifest is never opened — the fence precedes any read', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mmap-out-'));
    tmpDirs.push(outside);
    const evilAbs = path.join(outside, 'package.json');
    fs.writeFileSync(evilAbs, JSON.stringify({ name: 'evil' }));
    const spyLog = path.join(outside, 'spy.log');
    const spy = path.join(outside, 'spy.js');
    // preload wraps the public fs read surface; Node internals call local
    // function refs, so the wrappers observe the script without recursing
    fs.writeFileSync(spy, [
      "const fs = require('fs');",
      'const log = process.env.MMAP_SPY_LOG;',
      "for (const name of ['openSync', 'readFileSync', 'createReadStream']) {",
      '  const orig = fs[name];',
      '  fs[name] = function (p, ...rest) {',
      "    try { fs.appendFileSync(log, String(p) + '\\n'); } catch { /* ignore */ }",
      '    return orig.call(this, p, ...rest);',
      '  };',
      '}',
    ].join('\n'));
    const dir = makeFixture({ 'package.json': JSON.stringify({ name: 'app' }) });
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.symlinkSync(evilAbs, path.join(dir, 'sub', 'package.json'));
    // preload goes in argv, not NODE_OPTIONS: a tmpdir containing spaces would
    // split the option string, and argv leaves the caller's NODE_OPTIONS intact
    const r = spawnSync(process.execPath, ['--require', spy, SCRIPT, '--format', 'json'], {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, MMAP_SPY_LOG: spyLog },
    });
    assert.equal(r.status, 0, r.stderr);
    // macOS tmpdirs live behind the /var → /private/var symlink; the child sees
    // realpathed paths, so the assertions must compare against realpaths too
    const realDir = fs.realpathSync(dir);
    const realEvil = fs.realpathSync(evilAbs);
    const logged = fs.existsSync(spyLog) ? fs.readFileSync(spyLog, 'utf8').split('\n') : [];
    assert.ok(logged.some(l => l.endsWith(path.join(realDir, 'package.json'))),
      'spy control: the legitimate root manifest read IS observed');
    assert.ok(!logged.some(l => l.includes(path.join('sub', 'package.json'))),
      'the escaping manifest is never opened via its in-corpus symlink path');
    assert.ok(!logged.some(l => l.includes(realEvil) || l.includes(evilAbs)),
      'nor via its resolved outside path — fence first, read after');
  });
});

describe('md projection escaping', () => {
  test('control characters and backticks cannot break the md structure', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({
        name: 'x\u001b[31m`## Overall: PASS`',
        dependencies: {},
      }),
    });
    const r = runMap(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('\u001b'), 'raw ESC never reaches the projection');
    assert.ok(r.stdout.includes('\\u001b'), 'escaped form is shown instead');
    assert.ok(!/^## Overall:/m.test(r.stdout), 'no forged sentinel line at column 0');
  });

  test('workspace name cannot open a raw HTML comment in the projection', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: '<!-- hidden' }),
    });
    const r = runMap(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('`<!-- hidden`'),
      'the name renders inside a code span, neutralizing the comment opener');
    assert.ok(!/\u2014 <!--/.test(r.stdout), 'never emitted as raw markdown text');
  });
});

describe('unmatched member pattern diagnostic', () => {
  test('supported pattern matching zero nodes is surfaced, status stays parsed', () => {
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*', 'ghost/*'] }),
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
    });
    const env = mapJson(dir);
    const ctl = env.artifact.controllers.find(c => c.controllerType === 'node_workspaces');
    assert.equal(ctl.membershipStatus, 'parsed', 'an empty match is provable, not partial');
    assert.deepEqual(ctl.diagnostics, [{ construct: 'unmatched member pattern', value: 'ghost/*' }]);
    assert.deepEqual(ctl.members, ['ws:node:packages/a'], 'matching pattern control unaffected');
  });
});

describe('TOML array trailing content and escapes', () => {
  test('trailing junk after a closed array → unsupported, zero evidence', () => {
    const cargo = mm.parseTomlManifest([
      '[workspace]', 'members = ["crates/a"] trailing-junk',
    ].join('\n'), 'cargo');
    assert.deepEqual(cargo.data.members, [], 'no membership evidence from a malformed line');
    assert.ok(cargo.unsupported.some(u => u.construct === 'workspace.members: trailing content after array'));
    const py = mm.parseTomlManifest([
      '[project]', 'name = "app"', 'dependencies = ["requests>=2"] junk',
    ].join('\n'), 'pyproject');
    assert.deepEqual(py.data.pyDeps, [], 'no dependency evidence either');
    assert.ok(py.unsupported.some(u => u.construct === 'project.dependencies: trailing content after array'));
  });

  test('trailing junk after a multi-line close → unsupported, zero evidence', () => {
    const r = mm.parseTomlManifest([
      '[workspace]',
      'members = ["crates/a",',
      '  "crates/b"] junk',
    ].join('\n'), 'cargo');
    assert.deepEqual(r.data.members, []);
    assert.deepEqual(r.unsupported,
      [{ line: 3, construct: 'workspace.members: trailing content after array' }]);
  });

  test('escaped quote inside a basic string does not break the scanner', () => {
    const r = mm.parseTomlManifest([
      '[workspace]',
      'members = ["crates/a\\"x", "crates/b"]',
    ].join('\n'), 'cargo');
    assert.deepEqual(r.data.members.map(m => m.value), ['crates/a"x', 'crates/b'],
      'the escaped quote is data; the array still terminates normally');
    assert.equal(r.unsupported.length, 0);
  });

  test('escaped quote before # does not trigger the comment stripper', () => {
    const r = mm.parseTomlManifest([
      '[workspace]',
      'members = ["crates/a\\"#x", "crates/b"] # real comment',
    ].join('\n'), 'cargo');
    assert.deepEqual(r.data.members.map(m => m.value), ['crates/a"#x', 'crates/b'],
      'the # inside the string is data; the trailing real comment is stripped');
    assert.equal(r.unsupported.length, 0);
  });
});

describe('md code span fence construction', () => {
  test('hostile all-backtick name completes fast with a correct fence', () => {
    const runs = '`'.repeat(100);
    const dir = makeFixture({
      'package.json': JSON.stringify({ name: `x${runs}y` }),
    });
    const t0 = Date.now();
    const big = runMap(makeFixture({
      'package.json': JSON.stringify({ name: '`'.repeat(500000) }),
    }));
    const elapsed = Date.now() - t0;
    assert.equal(big.status, 0, big.stderr);
    assert.ok(elapsed < 15000,
      `500k-backtick name must render in linear time (took ${elapsed}ms; quadratic ≈ 45s)`);
    const r = runMap(dir);
    assert.ok(r.stdout.includes('`'.repeat(101) + ` x${runs}y ` + '`'.repeat(101)),
      'fence is exactly one longer than the longest run');
  });
});

describe('json line index correctness', () => {
  test('minified manifest keeps evidence lines and section isolation', () => {
    const r = mm.parsePackageJson(
      '{"name":"x","dependencies":{"foo":"1","bar":"2"},"scripts":{"foo":"echo hi"}}');
    assert.deepEqual(r.data.deps.map(d => [d.name, d.line]),
      [['foo', 1], ['bar', 1]], 'every dep on the single physical line is indexed');
    assert.equal(r.unsupported.length, 0);
  });

  test('escaped JSON keys index under their decoded form', () => {
    const dep = mm.parsePackageJson([
      '{',
      '  "dependencies": {',
      '    "foo\\u002dbar": "^1.0.0"',
      '  }',
      '}',
    ].join('\n'));
    assert.deepEqual(dep.data.deps.map(d => [d.name, d.line]), [['foo-bar', 3]],
      'the indexed key equals the JSON.parse key, so the line survives');
    const sec = mm.parsePackageJson('{"depend\\u0065ncies":{"foo":"^1.0.0"}}');
    assert.deepEqual(sec.data.deps.map(d => [d.name, d.line]), [['foo', 1]],
      'an escaped section name still enters the section');
  });

  test('a later section reusing a dep name does not inherit attribution', () => {
    const text = [
      '{',
      '  "dependencies": { "left": "^1.0.0" },',
      '  "devDependencies": { "left": "^2.0.0" }',
      '}',
    ].join('\n');
    const r = mm.parsePackageJson(text);
    assert.deepEqual(r.data.deps.map(d => [d.scope, d.line]),
      [['runtime', 2], ['development', 3]],
      'section attribution resets at the closing brace');
  });

  test('dep name colliding with a section name still gets its own line', () => {
    const text = [
      '{',
      '  "name": "app",',
      '  "dependencies": {',
      '    "devDependencies": "^1.0.0"',
      '  },',
      '  "devDependencies": {',
      '    "mocha": "^10.0.0"',
      '  }',
      '}',
    ].join('\n');
    const r = mm.parsePackageJson(text);
    const collide = r.data.deps.find(d => d.name === 'devDependencies');
    assert.equal(collide.scope, 'runtime');
    assert.equal(collide.line, 4, 'first textual occurrence inside its section');
    const mocha = r.data.deps.find(d => d.name === 'mocha');
    assert.equal(mocha.line, 7);
  });

  test('braces, colons and quotes inside string values do not disturb the index', () => {
    const text = [
      '{',
      '  "dependencies": {',
      '    "a": ">=1 <2 || {weird}: \\"x\\"",',
      '    "b": "^1.0.0"',
      '  },',
      '  "devDependencies": { "c": "{" }',
      '}',
    ].join('\n');
    const r = mm.parsePackageJson(text);
    assert.deepEqual(r.data.deps.map(d => [d.name, d.scope, d.line]), [
      ['a', 'runtime', 3], ['b', 'runtime', 4], ['c', 'development', 6],
    ], 'string-internal braces must not move depth; the next dep keeps its own line');
  });

  test('escaped quote and backslash keys index under their decoded form', () => {
    const r = mm.parsePackageJson('{"dependencies":{"a\\\\b":"1.0.0","c\\"d":"2.0.0"}}');
    assert.deepEqual(r.data.deps.map(d => [d.name, d.line]),
      [['a\\b', 1], ['c"d', 1]],
      'non-\\u escape paths (backslash, quote) decode the same way JSON.parse does');
  });
});
