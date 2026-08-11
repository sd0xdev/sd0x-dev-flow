const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');

const cliPath = resolve(__dirname, '../../scripts/classify-docs-cli.js');

test('CLI --feature returns valid JSON with doc_inventory', () => {
  const output = execFileSync('node', [cliPath, '--feature', 'doc-classification'], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
  const result = JSON.parse(output);
  assert.ok('doc_inventory' in result, 'must have doc_inventory');
  assert.ok('canonical_docs' in result, 'must have canonical_docs');
  assert.ok(Array.isArray(result.doc_inventory), 'doc_inventory must be array');
});

test('CLI with invalid feature returns the full shape, emptied', () => {
  const output = execFileSync('node', [cliPath, '--feature', '../escape'], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
  const result = JSON.parse(output);
  assert.ok(Array.isArray(result.doc_inventory) && result.doc_inventory.length === 0);
});

// The four source sets, on every exit the CLI has. A consumer calls `.map()` on these; a `{}` reply
// is a TypeError at the call site, on exactly the paths where it is hardest to diagnose. The
// no-repository exit is the one that used to print `{}`, so it is the case that must be run, not
// reasoned about — the other two would still pass if it regressed.
const SOURCE_SETS = ['current_authority', 'design_records', 'work_records', 'history_records'];

for (const [name, args, opts] of [
  ['a resolved feature', ['--feature', 'doc-classification'], {}],
  ['an unresolvable feature', ['--feature', '../escape'], {}],
  ['no repository at all', [], { cwd: tmpdir() }],
]) {
  test(`CLI emits all four source sets as arrays — ${name}`, () => {
    const output = execFileSync('node', [cliPath, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      ...opts,
    }).trim();
    const result = JSON.parse(output);
    for (const key of SOURCE_SETS) {
      assert.ok(Array.isArray(result[key]), `${key} must be an array, got ${typeof result[key]}`);
    }
    // `typeof x === 'object'` is true of `null` and of `[]`, so the old form here passed for a
    // reason that had nothing to do with the alias being right. Assert the exact four-key shape.
    assert.deepEqual(Object.keys(result.canonical_docs).sort(),
      ['architecture', 'feasibility', 'requirements', 'tech_spec']);
    for (const role of ['tech_spec', 'architecture', 'feasibility', 'requirements']) {
      const v = result.canonical_docs[role];
      assert.ok(v === null || typeof v.file === 'string', `${role} must be null or an entry`);
    }
    assert.ok(Array.isArray(result.doc_inventory));
    // Empty sets mean "none" only when this is false. Present on every exit, never undefined.
    assert.equal(typeof result.scan_error, 'boolean');
  });
}

test('scan_error separates "no documents" from "could not enumerate"', () => {
  // Both directions in one test, because either alone is satisfiable by a constant. A real feature
  // in this repo enumerates fine; an empty tmpdir is not a repository and enumerated nothing.
  const inRepo = JSON.parse(execFileSync('node', [cliPath, '--feature', 'doc-classification'],
    { encoding: 'utf8', timeout: 5000 }).trim());
  const noRepo = JSON.parse(execFileSync('node', [cliPath],
    { encoding: 'utf8', timeout: 5000, cwd: tmpdir() }).trim());

  assert.equal(inRepo.scan_error, false);
  assert.equal(noRepo.scan_error, true);
  assert.deepEqual(noRepo.current_authority, []);
});

test('an unexpected throw reaches the catch exit with the full shape, scan_error true', () => {
  // The `.catch()` is unreachable from any CLI argument, so the resolver is patched to throw
  // before the CLI module loads — `main()` rejects and the catch prints the empty payload.
  const resolverPath = resolve(__dirname, '../../scripts/lib/feature-resolver.js');
  const script = [
    `const resolver = require(${JSON.stringify(resolverPath)});`,
    "resolver.resolveFeatureContext = () => { throw new Error('boom'); };",
    `require(${JSON.stringify(cliPath)});`,
  ].join('\n');

  const out = execFileSync('node', ['-e', script], { encoding: 'utf8', timeout: 5000 }).trim();
  const result = JSON.parse(out);

  assert.equal(result.scan_error, true, 'the sets are unknown, not empty');
  for (const k of SOURCE_SETS) assert.deepEqual(result[k], [], k);
  assert.equal(result.canonical_docs.tech_spec, null);
});
