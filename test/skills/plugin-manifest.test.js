const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const pluginJsonPath = resolve(__dirname, '../../.claude-plugin/plugin.json');
const packageJsonPath = resolve(__dirname, '../../package.json');

const ALLOWED_FIELDS = new Set([
  'name', 'version', 'description', 'author', 'homepage',
  'repository', 'license', 'keywords',
  'commands', 'agents', 'skills', 'hooks',
  'mcpServers', 'outputStyles', 'lspServers',
]);

const COMPONENT_FIELDS = [
  'commands', 'agents', 'skills', 'hooks',
  'mcpServers', 'outputStyles', 'lspServers',
];

test('T1: plugin.json is valid JSON', () => {
  const raw = readFileSync(pluginJsonPath, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw), 'plugin.json is not valid JSON');
});

test('T2: name exists and is kebab-case', () => {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  assert.ok(plugin.name, 'plugin.json missing "name" field');
  assert.match(
    plugin.name,
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    `plugin.json name "${plugin.name}" is not kebab-case`
  );
});

test('T3: version synced with package.json', () => {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  assert.equal(
    plugin.version,
    pkg.version,
    `plugin.json version "${plugin.version}" does not match package.json version "${pkg.version}"`
  );
});

test('T4: no unknown fields', () => {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  const unknownFields = Object.keys(plugin).filter((k) => !ALLOWED_FIELDS.has(k));
  assert.equal(
    unknownFields.length,
    0,
    `plugin.json has unknown fields: ${unknownFields.join(', ')}`
  );
});

test('T5: component path values start with ./', () => {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));

  for (const field of COMPONENT_FIELDS) {
    const val = plugin[field];
    if (val === undefined) continue;

    if (typeof val === 'string') {
      assert.ok(
        val.startsWith('./'),
        `plugin.json "${field}" value "${val}" must start with "./"`
      );
    } else if (Array.isArray(val)) {
      for (const item of val) {
        assert.ok(
          typeof item === 'string' && item.startsWith('./'),
          `plugin.json "${field}" array item "${item}" must be a string starting with "./"`
        );
      }
    }
  }
});

test('T6: component fields are string, string[], or object[]', () => {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));

  for (const field of COMPONENT_FIELDS) {
    const val = plugin[field];
    if (val === undefined) continue;

    const isString = typeof val === 'string';
    const isStringArray = Array.isArray(val) && val.every((v) => typeof v === 'string');
    assert.ok(
      isString || isStringArray,
      `plugin.json "${field}" must be string or string[], got ${typeof val}`
    );
  }
});

test('T7: version is valid semver [recommended]', () => {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  assert.ok(plugin.version, '[recommended] plugin.json missing "version" field');
  assert.match(
    plugin.version,
    /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/,
    `[recommended] plugin.json version "${plugin.version}" is not valid semver`
  );
});

test('T8: description is non-empty string [recommended]', () => {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  assert.ok(
    typeof plugin.description === 'string' && plugin.description.trim(),
    '[recommended] plugin.json "description" must be a non-empty string'
  );
});

// The three descriptions a user reads before installing — plugin.json in the
// plugin listing, marketplace.json in the marketplace, package.json on npm.
// They drifted once (hook-lightweighting shipped in v4.2.x with two of them
// still advertising the enforcement model that release deleted), and a stale
// one is worse than none: it describes behaviour the installed plugin does not
// have. Retired vocabulary is listed rather than the current wording pinned,
// so ordinary rewording stays free while a revival of the old model fails.
// Each entry ships both directions, per rules/testing.md § Conventions "Guards": the retired
// phrasing the pattern must reject, and ordinary wording built from the SAME words that must
// survive. Pinning only the pattern would leave four of five guards with no failing control —
// green today because every live description happens to avoid them, and green tomorrow if one
// were mistyped into something that matches nothing.
const RETIRED_SEMANTICS = [
  {
    pattern: /hook-enforced/i,
    retired: 'hook-enforced review gates',
    ordinary: 'reminder-layer review hooks',
  },
  {
    pattern: /state-machine gate/i,
    retired: 'state-machine gates over a receipt ledger',
    ordinary: 'behaviour-layer gates the model runs and records',
  },
  {
    pattern: /STOP_GUARD_MODE/i,
    retired: 'set STOP_GUARD_MODE=strict to block',
    ordinary: 'a stop hook that reminds and always exits 0',
  },
  {
    pattern: /\bstrict mode\b/i,
    retired: 'strict mode blocks until the gate passes',
    ordinary: 'strictly scoped reminders that never block',
  },
  {
    pattern: /\bfail-closed sidecar\b/i,
    retired: 'a fail-closed sidecar receipt beside the repo',
    ordinary: 'fail-closed safety where it counts',
  },
];
const marketplaceJsonPath = resolve(__dirname, '../../.claude-plugin/marketplace.json');

// `.find()` reads the first match and says nothing about the second. A duplicate entry carrying
// retired vocabulary passed both T10 and T11 that way — the guards inspected an entry that was not
// the only one the marketplace publishes.
function marketplaceEntry(market, name) {
  const matches = (market.plugins || []).filter((p) => p.name === name);
  assert.equal(
    matches.length,
    1,
    `marketplace.json must list the plugin "${name}" exactly once; found ${matches.length}`
  );
  return matches[0];
}

function liveDescriptions() {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const market = JSON.parse(readFileSync(marketplaceJsonPath, 'utf8'));
  const entry = marketplaceEntry(market, plugin.name);
  return {
    'plugin.json': plugin.description,
    'package.json': pkg.description,
    'marketplace.json': entry.description,
  };
}

test('T10: no install-facing description advertises the retired enforcement model', () => {
  for (const [file, desc] of Object.entries(liveDescriptions())) {
    for (const { pattern } of RETIRED_SEMANTICS) {
      assert.doesNotMatch(
        desc,
        pattern,
        `${file} description still advertises retired semantics (${pattern}) — hook-lightweighting made the review layer reminders`
      );
    }
  }
});

for (const { pattern, retired, ordinary } of RETIRED_SEMANTICS) {
  test(`T10b: ${pattern} rejects its retired phrase and spares ordinary wording`, () => {
    assert.match(retired, pattern, `positive control: ${pattern} must catch "${retired}"`);
    assert.doesNotMatch(ordinary, pattern, `negative control: ${pattern} must spare "${ordinary}"`);
  });
}

test('T10c: the shipped description survives every guard', () => {
  // The whole live sentence, not a per-pattern fragment: a guard that is individually harmless can
  // still be collectively wrong about the wording the plugin actually ships.
  const current = 'reminder-layer review hooks, behaviour-layer gates, and fail-closed safety where it counts';
  for (const { pattern } of RETIRED_SEMANTICS) {
    assert.doesNotMatch(current, pattern, `the current wording must survive ${pattern}`);
  }
});

test('T11: plugin, marketplace, and package descriptions agree', () => {
  const descs = liveDescriptions();
  const unique = new Set(Object.values(descs));
  assert.equal(
    unique.size,
    1,
    `the three install-facing descriptions must be identical; got ${JSON.stringify(descs, null, 2)}`
  );
});

test('T9: keywords is string array [recommended]', () => {
  const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
  if (plugin.keywords === undefined) return;
  assert.ok(
    Array.isArray(plugin.keywords) && plugin.keywords.every((k) => typeof k === 'string'),
    '[recommended] plugin.json "keywords" must be an array of strings'
  );
});

test('T11b: a duplicate marketplace entry is rejected rather than shadowed', () => {
  const single = { plugins: [{ name: 'sd0x-dev-flow', description: 'reminder-layer review hooks' }] };
  const duplicated = {
    plugins: [...single.plugins, { name: 'sd0x-dev-flow', description: 'hook-enforced review gates' }],
  };
  assert.equal(
    marketplaceEntry(single, 'sd0x-dev-flow').description,
    'reminder-layer review hooks',
    'positive control: a single entry resolves to itself'
  );
  assert.throws(
    () => marketplaceEntry(duplicated, 'sd0x-dev-flow'),
    /exactly once/,
    'a second entry advertising the retired model must not hide behind the first'
  );
});
