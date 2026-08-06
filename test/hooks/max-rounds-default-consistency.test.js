// Cross-hook consistency for the auto-loop round cap default.
//
// The default is written in five independent places across three hooks. Changing the cap means
// changing all of them; missing one is silent, because each site is individually plausible and
// only disagrees with the others under a specific state shape. That happened: raising 10 → 30
// left `stop-guard.sh`'s `$ih == null` branch at "0 10", so a state file with a null
// iteration_history got the old budget while every other path got the new one.
//
// See rules/auto-loop.md § Tiers for what the cap means.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The single source of truth this suite pins everything against.
const EXPECTED_DEFAULT = 30;

test('every hook-side max_rounds default agrees', () => {
  const sites = [
    {
      file: 'hooks/post-compact-auto-loop.sh',
      label: 'post-compact jq // fallback',
      re: /\.iteration_history\.max_rounds \/\/ (\d+)/,
    },
    {
      // Anchored to the ITER_MAX assignment: `|| echo <n>` alone also matches unrelated
      // lock-timestamp and boolean fallbacks earlier in the same file.
      file: 'hooks/post-compact-auto-loop.sh',
      label: 'post-compact shell fallback when jq itself fails',
      re: /ITER_MAX=.*\|\| echo (\d+)\)/,
    },
    {
      // A third, easily-missed site: jq can succeed and still yield a non-numeric cap, which this
      // sanitizer replaces. It was left at the old default when the other two moved, so the
      // advisory reported a budget nobody enforced.
      file: 'hooks/post-compact-auto-loop.sh',
      label: 'post-compact non-numeric ITER_MAX sanitizer',
      re: /\|\| ITER_MAX=(\d+)/,
    },
    {
      file: 'hooks/stop-guard.sh',
      label: 'stop-guard null-iteration_history branch',
      re: /if \$ih == null then "0 (\d+)"/,
    },
    {
      file: 'hooks/stop-guard.sh',
      label: 'stop-guard absent-max_rounds branch',
      re: /\$ih\.max_rounds else (\d+) end\) as \$m/,
    },
    {
      file: 'hooks/post-tool-review-state.sh',
      label: 'post-tool-review-state absent-max_rounds branch',
      re: /\$ih\.max_rounds else (\d+) end\) as \$m/,
    },
    {
      file: 'hooks/post-tool-review-state.sh',
      label: 'post-tool-review-state project-setting default',
      re: /_read_project_int_setting "Max Rounds" "\$\{1:-(\d+)\}"/,
    },
    {
      file: 'hooks/post-edit-format.sh',
      label: 'post-edit-format project-setting default',
      re: /_read_project_int_setting "Max Rounds" "\$\{1:-(\d+)\}"/,
    },
  ];

  for (const { file, label, re } of sites) {
    const m = read(file).match(re);
    assert.ok(m, `${label} (${file}): pattern no longer matches — the site moved or was renamed, ` +
      'so this suite silently stopped guarding it');
    assert.equal(Number(m[1]), EXPECTED_DEFAULT,
      `${label} (${file}) must use the same default as every other site`);
  }
});

test('_read_project_max_rounds call sites pass the shared default', () => {
  // Two hooks initialise state and each passes an explicit fallback to the reader. A call site
  // passing a stale value overrides the reader's own default, so the reader agreeing is not enough.
  for (const file of ['hooks/post-tool-review-state.sh', 'hooks/post-edit-format.sh']) {
    const calls = [...read(file).matchAll(/_read_project_max_rounds (\d+)/g)];
    assert.ok(calls.length > 0, `${file}: expected at least one _read_project_max_rounds call site`);
    for (const c of calls) {
      assert.equal(Number(c[1]), EXPECTED_DEFAULT,
        `${file}: call site "${c[0]}" must pass the shared default`);
    }
  }
});

test('the tier table cap matches the hook default', () => {
  // rules/auto-loop.md is the behaviour-layer statement of the same number. A table saying 10
  // while the hooks enforce 30 sends the model and the hook to different conclusions about
  // whether the budget is spent.
  const m = read('rules/auto-loop.md').match(/\| `thorough` \|[^|]*\|[^|]*\| (\d+) \|/);
  assert.ok(m, 'auto-loop.md tier table row for `thorough` not found');
  assert.equal(Number(m[1]), EXPECTED_DEFAULT,
    'the thorough tier round cap must equal the hook-side default');
});

test('the project override template documents the same cap', () => {
  // rules/auto-loop-project.md is the template /install-rules copies to consumers. A stale cap
  // there ships wrong guidance to every new installation.
  const m = read('rules/auto-loop-project.md').match(/thorough\s+— P0\/P1\/P2 block;\s+cap (\d+)\./);
  assert.ok(m, 'auto-loop-project.md tier description for `thorough` not found');
  assert.equal(Number(m[1]), EXPECTED_DEFAULT,
    'the override template must document the same cap the hooks enforce');
});

test('jq-stub defaults in the hook test suites agree with the shipped default', () => {
  // The stubs mirror production's defaults. When those drift, the stub keeps answering with the
  // old cap and the tests still pass — they just stop exercising the shipped behaviour.
  //
  // Only DEFAULT shapes are pinned, never seeded fixtures: a fixture writing `max_rounds: 10` is
  // deliberate arbitrary state and must stay free to say so. Each shape below is distinguishable
  // from a fixture by its guard, its `vars.mr` binding, or its `||` / `//` fallback.
  const shapes = [
    // Spans lines: the same branch appears both inline and wrapped in braces, and a stale default
    // hid in the braced form while a same-line-only pattern reported full coverage.
    { label: 'migration mirror', re: /if \(!data\.iteration_history\)[\s\S]{0,120}?max_rounds: (\d+),/g },
    { label: '--argjson mr fallback', re: /vars\.mr !== undefined \? vars\.mr : (\d+)/g },
    { label: 'reset-guard cap fallback', re: /data\.iteration_history\.max_rounds \|\| (\d+)\)/g },
    { label: 'ITER_FILTER pick() default', re: /pick\(norm\.max_rounds, (\d+)\)/g },
    { label: 'jq `// N` query mirror', re: /\.iteration_history\.max_rounds \/\/ (\d+)/g },
    { label: 'jq `// N` handler fallback', re: /\}\)\.max_rounds\) \|\| (\d+)\)/g },
    // Both ternaries mirror stop-guard's `else N end` for an absent cap, and both evaded every
    // shape above — an exact count only helps once the syntactic inventory is complete.
    { label: 'absent-cap ternary (undefined/null)', re: /max_rounds === null \? (\d+) :/g },
    { label: 'absent-cap ternary (!= null)', re: /ih\.max_rounds != null \? ih\.max_rounds : (\d+)/g },
  ];

  // EXACT per-file counts, not an aggregate floor. A floor proves a guard is non-vacuous; it does
  // not prove the guard found every site — a real stale default sat behind a multiline branch
  // while the floor was satisfied by the eight sites it did match. An exact count fails on a site
  // added, removed, or reworded, which is the deliberate look this needs.
  const expected = {
    'test/hooks/review-phase.test.js': 6,
    'test/hooks/changed-files.test.js': 3,
    'test/hooks/post-edit-format.test.js': 1,
    // 4 since the stub gained an exact-match read branch for `.iteration_history.max_rounds // 30`
    // (the round/cap reads behind `_alf_common` and the mid-loop checkpoint).
    'test/hooks/post-tool-review-state.test.js': 4,
    'test/hooks/stop-guard.test.js': 2,
  };

  for (const [file, count] of Object.entries(expected)) {
    const src = read(file);
    let found = 0;
    for (const { label, re } of shapes) {
      for (const m of src.matchAll(re)) {
        found += 1;
        assert.equal(Number(m[1]), EXPECTED_DEFAULT,
          `${file}: ${label} defaults to ${m[1]} but the shipped default is ${EXPECTED_DEFAULT}`);
      }
    }
    assert.equal(found, count,
      `${file}: matched ${found} stub default sites, expected ${count}. Either a site was added ` +
      '(pin it here) or a shape stopped matching one (fix the pattern — do not lower the count).');
  }
});

test('`## Max Rounds` is documented as governing BOTH caps', () => {
  // The setting overrides the behaviour-layer tier cap AND the hook-persisted
  // iteration_history.max_rounds. The two only diverge when it is unset (tier 3/5/30 vs 30).
  // An earlier revision of the template described it as hook-side only and called it "NOT the
  // same number as the tier cap", which contradicts auto-loop.md § Tiers.
  //
  // Prose cannot be asserted for meaning. What this pins is narrow and deliberate: the
  // authoritative positive claim still exists, and the two retracted claims have not returned.
  assert.match(read('rules/auto-loop.md'), /`## Max Rounds`[^\n]*overrides the tier's cap/,
    'auto-loop.md § Tiers must still state that `## Max Rounds` overrides the behaviour-layer cap');
  assert.doesNotMatch(read('rules/auto-loop-project.md'), /NOT the same number as the tier cap/,
    'the override template reasserted the retracted "hook-side only" scope');
  // The spec is a SPLIT doc (`2-tech-spec/` + subs, per rules/docs-numbering.md § Size Limit), so
  // the whole folder is scanned rather than one file. Naming a single file would let the retracted
  // claim return in a sibling — or in a file created by the next split — with the guard still green.
  const specDir = 'docs/features/auto-loop-evolution/2-tech-spec';
  const specFiles = readdirSync(join(ROOT, specDir)).filter((f) => f.endsWith('.md'));
  assert.ok(specFiles.includes('2-tech-spec.md'),
    `${specDir} must keep the canonical main filename — doc-classifier keys is_canonical on it`);
  for (const f of specFiles) {
    assert.doesNotMatch(read(`${specDir}/${f}`), /兩者不會互相同步/,
      `${f} reasserted that the two cap layers never synchronize`);
  }
});

test('the override range still admits the default', () => {
  // `_read_project_int_setting` clamps a user override to 3..50 and otherwise returns the
  // fallback. A default outside that window would be unreachable by configuration, so a user
  // could never restate the shipped value explicitly.
  const src = read('hooks/post-tool-review-state.sh');
  const m = src.match(/"\$val" -ge (\d+) && "\$val" -le (\d+)/);
  assert.ok(m, 'the 3..50 override range check was not found');
  const [lo, hi] = [Number(m[1]), Number(m[2])];
  assert.ok(EXPECTED_DEFAULT >= lo && EXPECTED_DEFAULT <= hi,
    `default ${EXPECTED_DEFAULT} must fall inside the accepted override range ${lo}..${hi}`);
});
