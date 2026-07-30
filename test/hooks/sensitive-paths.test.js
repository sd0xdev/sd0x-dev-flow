// R4 — sensitive-path advisory hint (`_alf_sensitivity` in hooks/post-edit-format.sh).
// The helper is FILE-LOCAL, deliberately outside the byte-identical shared emitter block
// (auto-loop-state.test.js pins that block across six hooks; only this hook classifies edit
// paths). Advisory only: the output is extra key=value tokens on the code_edit fact line —
// it must never write review_mode, tier, or any enforcement state.
// Ticket: docs/features/auto-loop-autonomy/requests/2026-07-26-sensitive-path-advisory-hints-r4.md
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '../..');
const hookSrc = readFileSync(resolve(root, 'hooks/post-edit-format.sh'), 'utf8');

// Mirrors auto-loop-state.test.js — the helper ends at the first column-0 `}` by convention.
function extractHelper(src, name) {
  const i = src.indexOf(`${name}() {\n`);
  assert.notEqual(i, -1, `${name}: helper not found`);
  const j = src.indexOf('\n}\n', i);
  assert.notEqual(j, -1, `${name}: helper has no terminator`);
  return src.slice(i, j + 3);
}

// `_alf_sensitivity` calls `_alf_val` (shared block) on its output fields, so the harness
// carries both. Extracted, not sourced: the hook proper exits early without stdin/jq input.
const BLOCK_START = '# === [AUTO_LOOP_STATE] fact emitter ===\n';
const BLOCK_END = '    "$(_alf_read_tier)"\n}\n';
const bs = hookSrc.indexOf(BLOCK_START);
const be = hookSrc.indexOf(BLOCK_END, bs);
assert.notEqual(bs, -1, 'shared emitter block not found');
assert.notEqual(be, -1, 'shared emitter block has no terminator');
const sharedBlock = hookSrc.slice(bs, be + BLOCK_END.length);
const helper = extractHelper(hookSrc, '_alf_sensitivity');

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'alf-sens-'));
  const script = join(dir, 'run.sh');
  writeFileSync(script,
    `set -euo pipefail\nSTATE_FILE="${join(dir, 'state.json')}"\n${sharedBlock}\n${helper}\n_alf_sensitivity "$1"\n`);
  return { dir, script };
}

function run(script, cwd, filePath, env = {}) {
  const r = spawnSync('bash', [script, filePath], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env },
  });
  assert.equal(r.status, 0, `helper exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

const EXAMPLE_CONFIG = JSON.stringify({
  version: 1,
  rules: [
    {
      name: 'auth',
      include: ['auth', 'oauth', 'session'],
      exclude: ['docs', 'test', 'tests'],
      suggested_tier: 'thorough',
      suggested_route: '/codex-security',
    },
    {
      name: 'secrets',
      include: ['config/secrets'],
      exclude: [],
      suggested_tier: 'thorough',
      suggested_route: '/codex-review-branch',
    },
  ],
});

function withConfig(configText, fn, { configPath = 'scripts/config/sensitive-paths.json' } = {}) {
  const { dir, script } = makeDir();
  try {
    if (configText !== null) {
      mkdirSync(join(dir, ...configPath.split('/').slice(0, -1)), { recursive: true });
      writeFileSync(join(dir, configPath), configText);
    }
    fn({ dir, script });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Anchored segment matching (AC examples verbatim) ---

test('include segment matches at every path depth: auth, auth/login.ts, src/auth/login.ts', () => {
  withConfig(EXAMPLE_CONFIG, ({ dir, script }) => {
    for (const p of ['auth', 'auth/login.ts', 'src/auth/login.ts']) {
      const out = run(script, dir, p);
      assert.match(out, /^sensitivity_hint=high rule=auth suggested_tier=thorough suggested_route=\/codex-security$/,
        `${p}: expected an auth hit, got: ${out}`);
    }
  });
});

test('segment anchoring: author/index.ts is NOT a substring hit for `auth`', () => {
  withConfig(EXAMPLE_CONFIG, ({ dir, script }) => {
    assert.equal(run(script, dir, 'author/index.ts'), 'sensitivity=none');
    assert.equal(run(script, dir, 'src/oauth2/x.ts'), 'sensitivity=none',
      'oauth2 must not match segment `oauth`');
  });
});

test('exclude wins over include: test/auth path yields none', () => {
  withConfig(EXAMPLE_CONFIG, ({ dir, script }) => {
    assert.equal(run(script, dir, 'test/auth/login.test.ts'), 'sensitivity=none');
    assert.equal(run(script, dir, 'docs/features/auth/2-tech-spec.md'), 'sensitivity=none');
  });
});

test('multi-segment include entry matches the contiguous run only', () => {
  withConfig(EXAMPLE_CONFIG, ({ dir, script }) => {
    assert.match(run(script, dir, 'src/config/secrets/keys.ts'), /^sensitivity_hint=high rule=secrets /);
    assert.equal(run(script, dir, 'config/other/secrets-doc.ts'), 'sensitivity=none',
      'non-contiguous segments must not match config/secrets');
  });
});

test('absolute file_path is stripped against CLAUDE_PROJECT_DIR before matching', () => {
  withConfig(EXAMPLE_CONFIG, ({ dir, script }) => {
    const out = run(script, dir, join(dir, 'src/auth/login.ts'), { CLAUDE_PROJECT_DIR: dir });
    assert.match(out, /^sensitivity_hint=high rule=auth /);
  });
});

// --- Fail-loud config states ---

test('missing config → sensitivity=unknown (not none)', () => {
  withConfig(null, ({ dir, script }) => {
    assert.equal(run(script, dir, 'src/auth/login.ts'), 'sensitivity=unknown');
  });
});

test('invalid config (bad JSON / wrong version / rules not array) → sensitivity=unknown', () => {
  for (const bad of ['{not json', '{"version":2,"rules":[]}', '{"version":1,"rules":{}}']) {
    withConfig(bad, ({ dir, script }) => {
      assert.equal(run(script, dir, 'src/auth/login.ts'), 'sensitivity=unknown',
        `config ${bad}: expected unknown`);
    });
  }
});

test('ONE malformed rule invalidates the WHOLE config → unknown, even with well-formed siblings', () => {
  // All-or-nothing on purpose: dropping just the bad rule would let a typo'd config emit
  // `sensitivity=none` — which asserts "checked and clean" while the config was never fully
  // honored. `unknown` is the only honest verdict for a config the helper could not obey.
  const cfg = JSON.stringify({
    version: 1,
    rules: [
      { name: 42, include: 'nope' },
      { name: 'auth', include: ['auth'], suggested_tier: 'thorough', suggested_route: '/codex-security' },
    ],
  });
  withConfig(cfg, ({ dir, script }) => {
    assert.equal(run(script, dir, 'src/auth/login.ts'), 'sensitivity=unknown');
  });
});

test('optional fields with boolean false are schema-invalid, not defaulted away', () => {
  // jq `//` selects its right operand for `false` as well as `null` — validated by PRESENCE
  // instead, because `exclude:false` defaulting to `[]` would turn a malformed config into a
  // sensitive-path HIT rather than the required unknown.
  for (const patch of [{ exclude: false }, { suggested_tier: false }, { suggested_route: false },
    { exclude: null }]) {
    const cfg = JSON.stringify({ version: 1, rules: [{ name: 'auth', include: ['auth'], ...patch }] });
    withConfig(cfg, ({ dir, script }) => {
      assert.equal(run(script, dir, 'src/auth/login.ts'), 'sensitivity=unknown',
        `patch ${JSON.stringify(patch)}: expected config-invalid → unknown`);
    });
  }
});

test('values reserved by the line protocol (VALID verdict, `-` placeholder) are schema-invalid', () => {
  // A rule literally named `VALID` would be skipped by the row parser (silent miss → none);
  // a tier/route of `-` would decode as empty and be replaced by defaults. Both fail loudly.
  for (const patch of [{ name: 'VALID' }, { name: '-' }, { suggested_tier: '-' }, { suggested_route: '-' }]) {
    const cfg = JSON.stringify({ version: 1, rules: [{ name: 'auth', include: ['auth'], ...patch }] });
    withConfig(cfg, ({ dir, script }) => {
      assert.equal(run(script, dir, 'src/auth/login.ts'), 'sensitivity=unknown',
        `patch ${JSON.stringify(patch)}: expected config-invalid → unknown`);
    });
  }
});

test('segments colliding with the transport encoding are rejected as invalid, not mis-decoded', () => {
  // `,` joins the segment list, `-` is the empty-field TSV placeholder, and \t \n \r \\ are
  // characters @tsv escapes but the bash reader never decodes — any of them would silently
  // split, vanish, or never-match, so the validator fails the config loudly instead.
  for (const seg of ['a,b', '-', '', 'a\tb', 'a\nb', 'a\rb', 'a\\b']) {
    const cfg = JSON.stringify({ version: 1, rules: [{ name: 'x', include: [seg] }] });
    withConfig(cfg, ({ dir, script }) => {
      assert.equal(run(script, dir, 'src/auth/login.ts'), 'sensitivity=unknown',
        `segment ${JSON.stringify(seg)}: expected config-invalid → unknown`);
    });
  }
});

test('empty rules array is valid → clean miss reads none, not unknown', () => {
  const cfg = JSON.stringify({ version: 1, rules: [] });
  withConfig(cfg, ({ dir, script }) => {
    assert.equal(run(script, dir, 'src/auth/login.ts'), 'sensitivity=none');
  });
});

test('.claude/scripts/config takes precedence over scripts/config', () => {
  const override = JSON.stringify({
    version: 1,
    rules: [{ name: 'proj', include: ['auth'], suggested_tier: 'standard', suggested_route: '/codex-review-fast' }],
  });
  withConfig(EXAMPLE_CONFIG, ({ dir, script }) => {
    mkdirSync(join(dir, '.claude/scripts/config'), { recursive: true });
    writeFileSync(join(dir, '.claude/scripts/config/sensitive-paths.json'), override);
    assert.match(run(script, dir, 'src/auth/login.ts'), /^sensitivity_hint=high rule=proj suggested_tier=standard /);
  });
});

test('missing suggested fields fall back to thorough + /codex-review-branch', () => {
  const cfg = JSON.stringify({ version: 1, rules: [{ name: 'auth', include: ['auth'] }] });
  withConfig(cfg, ({ dir, script }) => {
    assert.equal(run(script, dir, 'auth/x.ts'),
      'sensitivity_hint=high rule=auth suggested_tier=thorough suggested_route=/codex-review-branch');
  });
});

// --- Advisory-only guarantees ---

test('helper body performs no enforcement writes (no state file, no review_mode, no sidecar)', () => {
  // Diff-provable AC: the helper reads a config and prints tokens — nothing else. Any of these
  // identifiers appearing in its body would mean it gained a write path into enforcement state.
  for (const forbidden of ['STATE_FILE', 'review_mode', 'update_state', 'update_change_flag',
    'invalidate_review', 'invalidate_aggregate_gate', '_set_own_sidecar', 'mktemp', 'mv ', '> "$']) {
    assert.ok(!helper.includes(forbidden),
      `_alf_sensitivity must stay read-only; found forbidden token: ${forbidden}`);
  }
});

test('helper lives OUTSIDE the byte-identical shared emitter block', () => {
  assert.ok(!sharedBlock.includes('_alf_sensitivity'),
    'widening the shared block forces five no-op copies across the other emitter hooks');
});

test('both code_edit emit sites carry the sensitivity hint; doc_edit sites do not', () => {
  const codeEmits = hookSrc.split('\n').filter((l) => l.includes('event=code_edit'));
  assert.equal(codeEmits.length, 2, 'expected exactly two code_edit emit sites (committed + degraded)');
  const emitCalls = hookSrc.split('_alf_emit "event=code_edit').slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('>&2')));
  assert.equal(emitCalls.length, 2);
  for (const call of emitCalls) {
    assert.ok(call.includes('$(_alf_sensitivity "${file_path}")'),
      `code_edit emit site missing sensitivity hint: ${call}`);
  }
  const docEmits = hookSrc.split('_alf_emit "event=doc_edit').slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('>&2')));
  for (const call of docEmits) {
    assert.ok(!call.includes('_alf_sensitivity'),
      'doc_edit emit sites must not carry the code-plane sensitivity hint');
  }
});

// --- Shipped config sanity ---

test('shipped scripts/config/sensitive-paths.json is valid and example-scoped', () => {
  const shipped = JSON.parse(readFileSync(resolve(root, 'scripts/config/sensitive-paths.json'), 'utf8'));
  assert.equal(shipped.version, 1);
  assert.ok(Array.isArray(shipped.rules) && shipped.rules.length > 0);
  for (const r of shipped.rules) {
    assert.equal(typeof r.name, 'string');
    assert.ok(Array.isArray(r.include) && r.include.length > 0, `${r.name}: include must be a non-empty array`);
    assert.ok(Array.isArray(r.exclude), `${r.name}: exclude must be an array`);
    assert.match(r.suggested_tier, /^(fast|standard|thorough)$/);
    assert.match(r.suggested_route, /^\//);
  }
  // The defaults are examples, not a coverage claim — the config must say so.
  assert.match(shipped._comment, /EXAMPLE/i);
  assert.match(shipped._comment, /NOT complete/i);
});

test('helper against the shipped config: hit, miss, and docs-exclusion', () => {
  const shippedText = readFileSync(resolve(root, 'scripts/config/sensitive-paths.json'), 'utf8');
  withConfig(shippedText, ({ dir, script }) => {
    assert.match(run(script, dir, 'src/auth/login.ts'), /^sensitivity_hint=high rule=auth /);
    assert.equal(run(script, dir, 'src/service/user.ts'), 'sensitivity=none');
    assert.equal(run(script, dir, 'docs/auth/overview.md'), 'sensitivity=none');
  });
});

// --- End-to-end: the full hook, not the extracted helper ---

test('full hook run: code_edit fact line carries file= (the path field) plus the hint tokens', () => {
  // AC4 lists `path` among the advisory fields ("等建議欄位" — an example list): the fact line's
  // pre-existing `file=` token IS the path carrier, so the hint helper does not duplicate it.
  // This pins that whole-line contract end-to-end — field composition, placement, and escaping
  // are asserted on the real emitted line, not inferred from helper-output shape.
  const { dir } = (() => { const d = mkdtempSync(join(tmpdir(), 'alf-sens-e2e-')); return { dir: d }; })();
  try {
    mkdirSync(join(dir, 'scripts/config'), { recursive: true });
    writeFileSync(join(dir, 'scripts/config/sensitive-paths.json'), EXAMPLE_CONFIG);
    const r = spawnSync('bash', [resolve(root, 'hooks/post-edit-format.sh')], {
      cwd: dir, encoding: 'utf8', env: { ...process.env },
      input: JSON.stringify({ tool_input: { file_path: 'src/auth/login.ts' } }),
    });
    assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
    const fact = r.stderr.split('\n').find((l) => l.startsWith('[AUTO_LOOP_STATE] event=code_edit'));
    assert.ok(fact, `no code_edit fact line in stderr: ${r.stderr}`);
    assert.match(fact, / file=src\/auth\/login\.ts /);
    assert.match(fact, / sensitivity_hint=high rule=auth suggested_tier=thorough suggested_route=\/codex-security$/);
    assert.ok(!fact.includes('review_mode'), 'the fact line must not carry enforcement fields');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Performance budget ---

// Median, not mean: the budget is the hook's TYPICAL cost, and under the full suite's parallel
// load a mean absorbs scheduler-contention spikes and fails spuriously, while a median still
// fails when most runs are slow (a genuine regression). Min would be weaker — one lucky run
// must not pass a hook that is typically over budget.
function medianMs(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test('classification of the SHIPPED config stays under the 50ms budget (median of 11, full miss)', () => {
  // The absolute budget is asserted against the config the plugin actually ships — not a reduced
  // fixture — and on a MISS, which walks every rule to the end (worst case). The extreme-scale
  // test below owns the "no per-rule traversal" scaling property; this one owns the 50ms contract.
  const shippedText = readFileSync(resolve(root, 'scripts/config/sensitive-paths.json'), 'utf8');
  withConfig(shippedText, ({ dir, script }) => {
    assert.equal(run(script, dir, 'src/plain/helper.ts'), 'sensitivity=none', 'fixture must be a full miss');
    // Warm-up already happened via the assertion run; then 11 timed runs.
    const times = [];
    for (let i = 0; i < 11; i++) {
      const t0 = process.hrtime.bigint();
      run(script, dir, 'src/plain/helper.ts');
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    const med = medianMs(times);
    assert.ok(med < 50, `median ${med.toFixed(1)}ms exceeds the 50ms advisory budget on the shipped config (runs: ${times.map((t) => t.toFixed(0)).join(',')})`);
  });
});

test('an extreme valid config (100 rules × 10 segments) scales flat relative to the 2-rule example config', () => {
  // The schema caps neither rule nor segment count, so scaling is benchmarked at a size no sane
  // project config approaches — and on a full MISS, which walks every rule to the end.
  //
  // RELATIVE assertion, not the absolute 50ms budget: an absolute wall-clock bound at this scale
  // measures the machine under the full suite's parallel load, not the hook (observed 47–68ms for
  // the same code that runs <40ms standalone — sustained contention, so median cannot rescue it
  // either). Measurements are PAIRED and interleaved in AB/BA order so scheduler drift lands on
  // adjacent numerator and denominator alike and cancels in each pair's ratio; disjoint windows
  // would not cancel (load can shift between them). What the ratio catches is an introduced
  // per-rule traversal (find/grep, one jq per rule), which multiplies the extreme config's cost
  // while leaving the 2-rule config's untouched. The absolute 50ms contract stays owned by the
  // test above; the loose ceiling here is a runaway backstop, not a budget.
  const big = JSON.stringify({
    version: 1,
    rules: Array.from({ length: 100 }, (_, i) => ({
      name: `rule${i}`,
      include: Array.from({ length: 10 }, (_, j) => `seg${i}x${j}`),
      exclude: ['docs', 'test'],
      suggested_tier: 'thorough',
      suggested_route: '/codex-security',
    })),
  });
  const timeOne = ({ dir, script }, file) => {
    const t0 = process.hrtime.bigint();
    run(script, dir, file);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const FILE = 'src/service/user.ts';
  withConfig(EXAMPLE_CONFIG, (ctrl) => {
    withConfig(big, (ext) => {
      assert.equal(run(ext.script, ext.dir, FILE), 'sensitivity=none');
      run(ctrl.script, ctrl.dir, FILE); // warm-up both harnesses
      const ratios = [];
      const ctrlTimes = [];
      const extTimes = [];
      for (let i = 0; i < 7; i++) {
        let tc; let te;
        if (i % 2 === 0) {
          tc = timeOne(ctrl, FILE); te = timeOne(ext, FILE);
        } else {
          te = timeOne(ext, FILE); tc = timeOne(ctrl, FILE);
        }
        ctrlTimes.push(tc); extTimes.push(te);
        ratios.push(te / Math.max(tc, 1));
      }
      const ratio = medianMs(ratios); // medianMs sorts and takes the middle — works for ratios too
      const detail = `extreme runs: ${extTimes.map((t) => t.toFixed(0)).join(',')}; control runs: ${ctrlTimes.map((t) => t.toFixed(0)).join(',')}`;
      assert.ok(ratio < 2.5,
        `100×10 config costs ${ratio.toFixed(2)}× the 2-rule example config per paired run (${detail}) — a per-rule traversal has likely been introduced`);
      const extMed = medianMs(extTimes);
      assert.ok(extMed < 250, `runaway backstop: median ${extMed.toFixed(1)}ms at 100×10 scale (${detail})`);
    });
  });
});
