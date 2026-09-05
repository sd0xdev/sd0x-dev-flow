'use strict';
// Negative guards for the single-transport-authority property (docs/features/codex-exec-transport/
// 2-tech-spec.md § 3.4).
//
// Two design rules learned the hard way, both from review findings on this very file:
//
// 1. **Each guard is ONE predicate function, and its self-test calls that same function.** An
//    earlier version re-implemented the filter inline in each self-test, so a self-test could pass
//    while the production assertion missed the same input (`@rules/testing.md` § Guards: test and
//    controls invoke the same implementation).
// 2. **A predicate must cover the SHAPE, not one spelling of it.** The first version matched
//    `--protocol 1 <subcommand>` adjacently and `codex exec` followed by a flag, so
//    `start --protocol 1`, `codex exec - < prompt.md`, `codex exec "review this"` and
//    `--class "$CLASS"` all sailed through while the adapter accepted them. The synthetic
//    self-tests planted only the spellings already recognised, which is how a guard passes and
//    protects nothing.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const SURFACES = ['skills', 'agents', 'rules'];
const TRANSPORT_REF = 'skills/codex-code-review/references/codex-transport.md';
const IMPLEMENT_OWNER = 'skills/codex-implement/';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

// One corpus shape everywhere: [path, content]. `extra` lets a self-test add a synthetic file
// without writing into a scanned directory — planting a real file there races every other suite
// `node --test` runs in parallel (measured: contract-routing.test.js failed ENOENT on it).
const corpus = (extra = []) => [
  ...SURFACES.flatMap((d) => walk(d)).map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]),
  ...extra,
];

// Logical lines: a trailing backslash continues a command, so the shell sees one line and so must we.
const logicalLines = (content) => content.replace(/\\\n\s*/g, ' ').split('\n');

// ── Guard 1: a CLOSED predicate, not a shape matcher ─────────────────────────────────────────
// Two review rounds of shape-matching produced two rounds of evasions — `start --protocol 1`,
// `codex exec - < prompt.md`, `codex exec "prompt"`, then `cat p.md | codex exec`,
// `codex exec summarize`, `ACTION=start; node $ADAPTER --protocol 1 $ACTION`. Every fix invited
// the next spelling, because "is this line operational?" is an open-ended question about text.
//
// The invariant is not open-ended: the transport is stated in ONE file. So the predicate is
// membership, not shape — outside the authority (and a shrinking allowlist of files later tickets
// own), a surface may not contain a transport token AT ALL. A skill that needs to talk about
// dispatching cites `codex-transport.md`; it never spells the mechanism. No spelling evades a
// token scan, and there is nothing left to add a case for.
// TOKEN ORDER, not option grammar. Three review rounds were spent enumerating what may sit between
// the binary and its subcommand — adjacency, then global options, then quoted values, redirections,
// `--config 'model = "gpt 5"'` — and each enumeration invited the next form. The CLI's own grammar
// is not the invariant; the invariant is that this line names the binary and then its command.
// So: `codex` appears, and LATER ON THE SAME LOGICAL LINE the token `exec` or `e` appears. Nothing
// in between is modelled, so nothing in between can evade it.
const CODEX_INVOCATION = /\bcodex\b.*(?:^|[\s'"`|;&(])(?:exec|e)(?![\w-])/;

const TRANSPORT_TOKENS = [
  CODEX_INVOCATION,
  /\bcodex-exec\b/,       // the adapter file name
  /--protocol\b/,          // the handshake every dispatch carries
  /--prompt-file\b/,
  /--report-file\b/,
  /--thread-id\b/,
];

// Files that still carry a transport token and are owned by a later ticket. Like Guard 2's
// inventory this must EQUAL reality, so it cannot rot: item 4 converts the agent, and this empties.
// Emptied once `agents/codex-implementer.md` became an explicit `/codex-implement` router: it no
// longer names an invocation, so it needs no exemption. The list stays as the declared mechanism —
// a future surface awaiting conversion goes here and is visible, rather than silently un-scanned.
const GUARD1_PENDING = [];

// Per LOGICAL line: a trailing backslash continues a command, so `codex \<newline> exec -` is one
// statement to the shell and must be one string here. Scanning raw content missed exactly that,
// and left `logicalLines` declared but unused — a normalization nothing called.
// Shell escaping and quoting produce the same ARGUMENT from different lexical spellings —
// `codex \exec`, `codex \e`, `codex ex""ec` all reach the CLI. Matching raw text therefore misses
// them, so each logical line is de-quoted before matching: drop backslashes and quote characters,
// which is what the shell does to them. One normalization closes the whole class rather than one
// spelling at a time.
const deQuote = (line) => line.replace(/[\\'"`]/g, '');
const hasTransportToken = (content) =>
  logicalLines(content).map(deQuote).some((line) => TRANSPORT_TOKENS.some((re) => re.test(line)));

function transportTokenOffenders(files = corpus()) {
  return files
    .filter(([p]) => p !== TRANSPORT_REF && !GUARD1_PENDING.includes(p))
    .filter(([, c]) => hasTransportToken(c))
    .map(([p]) => p)
    .sort();
}

// ── Guard 3: class ownership, also closed ─────────────────────────────────────────────────────
// Same lesson: not "does an unquoted `--class implement` appear". Outside the owner and the
// authority, the only class value that may ever be written is the literal `review`, AND the word
// `implement` may not appear as a class claim in prose either ("using the implement operation
// class", "class implement"). Guard 1 already stops a non-owner spelling a dispatch at all, so
// this covers what is left: a skill *asking* for the write-capable class in words.
// Capture the whole argument, then normalize: `\w+` alone let `<the caller's class>` through,
// because a placeholder is not a word — and a placeholder in a non-owner file is exactly the
// "this file spells a dispatch" case this guard exists for.
const CLASS_ARG = /--class\s+(\S+)/g;
const normalizeClass = (v) => v.replace(/^[`'"<]+/, '').replace(/[`'">),.;]+$/, '');
const CLASS_PROSE = /\bimplement\b[^.\n]{0,40}\bclass\b|\bclass\b[^.\n]{0,40}\bimplement\b/i;
const ALLOWED_NON_OWNER_CLASS = new Set(['review']);

// The class is a NAME for a capability, and a non-owner can select the capability without saying
// the name: "dispatch per § Start in workspace-write mode" reaches implement because that is the
// only class mapped to it. So the sandbox names are owned too. `codex-setup` is listed because its
// mention is about its OWN execution mode, not a dispatch — an inventory, equality-checked below,
// not a proximity heuristic.
const WRITE_SANDBOX = /\b(?:workspace-write|danger-full-access)\b/;
const SANDBOX_PENDING = ['skills/codex-setup/SKILL.md'];

function classOwnershipOffenders(files = corpus()) {
  const bad = [];
  for (const [p, c] of files) {
    if (p === TRANSPORT_REF || p.startsWith(IMPLEMENT_OWNER)) continue;
    for (const m of c.matchAll(CLASS_ARG)) {
      const value = normalizeClass(m[1]);
      if (!ALLOWED_NON_OWNER_CLASS.has(value)) bad.push(`${p} (--class ${value})`);
    }
    if (CLASS_PROSE.test(c)) bad.push(`${p} (implement class claimed in prose)`);
    if (WRITE_SANDBOX.test(c) && !SANDBOX_PENDING.includes(p)) {
      bad.push(`${p} (write-capable sandbox selected outside the owner)`);
    }
  }
  return bad.sort();
}

// ── Guard 2: the MCP transport token, retired surface by surface ──────────────────────────────
const MCP_TOKEN = /mcp__codex/;

function mcpOffenders(files = corpus()) {
  return files.filter(([, c]) => MCP_TOKEN.test(c)).map(([p]) => p).sort();
}
const inDir = (files, dir) => files.filter(([p]) => p.startsWith(`${dir}/`));

describe('Guard 1 — no transport token outside the canonical reference', () => {
  test('the tree is clean apart from the files later tickets own', () => {
    assert.deepEqual(transportTokenOffenders(), [],
      `the transport is stated only in ${TRANSPORT_REF}; cite it, never restate it`);
  });

  test('the pending list EQUALS the surfaces still carrying a token — it cannot rot', () => {
    const withTokens = corpus()
      .filter(([p]) => p !== TRANSPORT_REF)
      .filter(([, c]) => hasTransportToken(c))
      .map(([p]) => p)
      .sort();
    assert.deepEqual(withTokens, [...GUARD1_PENDING].sort(),
      'a file was converted (drop it) or a new one appeared (convert it or add it deliberately)');
  });

  test('the canonical reference does carry the four subcommands it owns', () => {
    const ref = fs.readFileSync(path.join(ROOT, TRANSPORT_REF), 'utf8');
    for (const sub of ['alloc', 'start --class', 'resume --thread-id', 'cleanup <dir>']) {
      assert.ok(ref.includes(sub), `${TRANSPORT_REF} must spell out: ${sub}`);
    }
  });

  // Self-tests: the SAME predicate, fed every evasion two review rounds produced. None of these
  // needs its own rule — a token scan has no shape to slip past.
  for (const [name, line] of [
    ['flag-then-subcommand', 'node .claude/scripts/codex-exec.js --protocol 1 start --class review'],
    ['subcommand-then-flag', 'node .claude/scripts/codex-exec.js start --protocol 1 --class review'],
    ['variable-selected subcommand', 'ACTION=start; node $ADAPTER --protocol 1 $ACTION --class review'],
    ['bare piped stdin', 'cat prompt.md | codex exec'],
    ['unquoted positional prompt', 'codex exec summarize'],
    ['stdin dash', 'codex exec - < prompt.md'],
    ['quoted positional prompt', 'codex exec "review this tree"'],
    ['resume subcommand', 'codex exec resume $ID'],
    ['prose mention of the mechanism', 'we dispatch with `codex exec` from the skill'],
    ['the official e alias', 'cat prompt.md | codex e - < prompt.md'],
    ['the e alias with a subcommand', 'codex e resume $ID'],
    ['a global option before exec', 'codex -p review exec -'],
    ['a long global option before the alias', 'codex --profile review e -'],
    ['a quoted binary name', "'codex' exec -"],
    ['a backslash continuation before the subcommand', 'codex \\\n  exec -'],
    ['an equals-form global option', 'codex --profile=review exec --json'],
    ['a quoted directory argument', 'codex -C "/tmp/project with spaces" exec -'],
    ['a quoted config value containing spaces', "codex --config 'model = \"gpt 5\"' exec -"],
    ['an input redirection before the subcommand', 'codex < /dev/null exec -'],
    ['a stderr redirection before the alias', 'codex 2>/tmp/cx.log e -'],
    ['a backslash-escaped subcommand', 'codex \\exec --help'],
    ['a backslash-escaped alias', 'codex \\e --help'],
    ['an empty-quote-split subcommand', 'codex ex""ec --help'],
    ['a lone file flag', 'pass --prompt-file <dir>/prompt.md to the adapter'],
  ]) {
    test(`self-test: fires on ${name}`, () => {
      assert.deepEqual(transportTokenOffenders(corpus([['rules/SYNTHETIC.md', line]])),
        ['rules/SYNTHETIC.md']);
    });
  }

  for (const [name, line] of [
    ['a citation, which is what a call site should write',
      'Render the prompt body into a private prompt file, then dispatch per `codex-transport.md` § Start.'],
    ['a capitalized carrier label in prose', 'Review (Codex exec) — the carrier this family uses'],
    ['ordinary prose naming the reviewer', 'Codex is a second pair of eyes, not a rubber stamp.'],
  ]) {
    test(`self-test: stays quiet on ${name}`, () => {
      assert.deepEqual(transportTokenOffenders([['skills/codex-explain/SYNTHETIC.md', line]]), []);
    });
  }
});

describe('Guard 2 — the MCP transport token is retired surface by surface', () => {
  // An inventory of the paths that still carry the token, not a count of grantees: it shrinks as
  // items 3-5 convert their surfaces and is empty when item 5 lands. The equality assertion below
  // fails on a stale entry too, so the list cannot rot.
  const GUARD2_ALLOW = [
    // Empty, and work item 5 owns that state: every surface that carried an `mcp__codex` token has
    // been converted. The list stays as the declared mechanism — a surface awaiting conversion goes
    // here and is visible — but the equality assertion below now proves the tree holds none.
  ].sort();

  test('the allowlist EQUALS the set of token-bearing paths — a converted or stale entry fails', () => {
    assert.deepEqual(mcpOffenders(), GUARD2_ALLOW,
      'a surface was converted (drop it from the allowlist) or a new one appeared (convert it)');
  });

  test('rules/ is already clean — the invocation contract names no carrier', () => {
    assert.deepEqual(mcpOffenders(inDir(corpus(), 'rules')), []);
  });

  test('agents/ is already clean', () => {
    assert.deepEqual(mcpOffenders(inDir(corpus(), 'agents')), []);
  });

  test('self-test: fires on a synthetic rules/ offender', () => {
    assert.deepEqual(
      mcpOffenders(inDir(corpus([['rules/SYNTHETIC.md', 'dispatch with mcp__codex__codex here']]), 'rules')),
      ['rules/SYNTHETIC.md']
    );
  });
});

describe('Guard 3 — only codex-implement may reach the implement class', () => {
  test('no non-owner writes a class other than review, or claims the class in prose', () => {
    assert.deepEqual(classOwnershipOffenders(), [],
      'workspace-write belongs to codex-implement alone');
  });

  test('the canonical reference names the owner by path', () => {
    const ref = fs.readFileSync(path.join(ROOT, TRANSPORT_REF), 'utf8');
    assert.match(ref, /--class implement/, 'the reference spells the class');
    assert.match(ref, /skills\/codex-implement\//, 'the reference names its sole owner');
  });

  for (const [name, line] of [
    ['a literal claim', 'dispatch with --class implement to rewrite the file'],
    ['a quoted value', 'dispatch with --class "implement" to rewrite the file'],
    ['a shell variable', 'dispatch with --class "$CLASS" where CLASS=implement'],
    ['a placeholder', "dispatch with --class <the caller's class>"],
    ['a prose claim', 'dispatch per § Start using the implement operation class'],
    ['a reversed prose claim', 'the class to use here is implement, not review'],
    ['the capability without its class name', 'dispatch per codex-transport.md § Start in workspace-write mode'],
    ['the widest sandbox', 'dispatch per § Start with danger-full-access'],
  ]) {
    test(`self-test: fires on ${name}`, () => {
      const offenders = classOwnershipOffenders(corpus([['skills/codex-explain/SYNTHETIC.md', line]]));
      assert.ok(offenders.length >= 1, `expected an offender, got none for: ${line}`);
      assert.ok(offenders.every((o) => o.startsWith('skills/codex-explain/SYNTHETIC.md')),
        `unexpected offenders: ${offenders.join(', ')}`);
    });
  }

  test('self-test: stays quiet on the one value a non-owner may write', () => {
    assert.deepEqual(
      classOwnershipOffenders([['skills/codex-explain/SYNTHETIC.md', 'dispatch with --class review']]), []);
  });

  test('self-test: stays quiet on the read-only sandbox, which every caller may name', () => {
    assert.deepEqual(
      classOwnershipOffenders([['skills/codex-explain/SYNTHETIC.md', 'this runs read-only']]), []);
  });

  test('the sandbox pending list EQUALS the non-owner files naming a write sandbox', () => {
    const naming = corpus()
      .filter(([p]) => p !== TRANSPORT_REF && !p.startsWith(IMPLEMENT_OWNER))
      .filter(([, c]) => WRITE_SANDBOX.test(c))
      .map(([p]) => p)
      .sort();
    assert.deepEqual(naming, [...SANDBOX_PENDING].sort(),
      'a file started or stopped naming a write-capable sandbox — update the inventory deliberately');
  });
});

describe('Guard 4 — a skill that only routes holds no transport grant', () => {
  // Work item 3 added the grants with a loop and got the classification backwards in both
  // directions: five thin entry points that dispatch nothing were pre-approved for `Bash(node:*)`
  // and `Write`, while `seek-verdict` — which does dispatch — declared no tools at all and would
  // have hit a permission prompt mid-review. Ownership is a per-file fact, so pin it as one.
  const ROUTERS = ['codex-review', 'codex-review-fast', 'codex-review-branch', 'codex-review-doc',
    'codex-test-review'];

  const frontmatter = (skill) => {
    const src = fs.readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    const m = src.match(/^allowed-tools: (.+)$/m);
    return { tools: m ? m[1] : '', src };
  };

  for (const skill of ROUTERS) {
    test(`${skill} routes to a parent skill and therefore holds no transport grant`, () => {
      const { tools, src } = frontmatter(skill);
      // Both grants, not just node: adding `Write` back to a router passed the earlier version.
      assert.doesNotMatch(tools, /Bash\(node:\*\)/, `${skill} dispatches nothing; it needs no node grant`);
      assert.doesNotMatch(tools, /\bWrite\b/, `${skill} writes no prompt file; it needs no Write grant`);
      assert.doesNotMatch(src, /codex-transport\.md|§ (Start|Resume)/,
        `${skill} must not dispatch — if it now does, it is no longer a router and this pin must move`);
    });
  }

  test('seek-verdict dispatches itself and therefore declares the transport grants', () => {
    const { tools, src } = frontmatter('seek-verdict');
    // Every grant the dispatch choreography needs — removing Write or Read passed the earlier version.
    for (const grant of [/Bash\(node:\*\)/, /\bWrite\b/, /\bRead\b/]) {
      assert.match(tools, grant, `the actual owner must not rely on a permission prompt for ${grant}`);
    }
    // "Occurs somewhere" was too weak: `do not dispatch per … § Start` passed, and so did swapping
    // the fresh dispatch to § Resume. Pin the two instructions by their own semantics.
    const CANON = '@skills/codex-code-review/references/codex-transport.md';
    const fresh = src.split('\n').find((l) => l.includes(CANON) && /§ Start/.test(l));
    assert.ok(fresh, 'the fresh dispatch must cite the canonical transport § Start');
    assert.doesNotMatch(fresh, /\b(do not|never|must not)\s+dispatch/i,
      'the § Start citation must be an affirmative instruction, not a prohibition');
    assert.match(fresh, /[Ff]resh|Start/, 'the § Start line is the fresh-dispatch instruction');
    // Enumerating negative words failed: `never use § Resume` carries no `dispatch` verb and passed.
    // Pin the affirmative instruction itself instead.
    // Substring matching let `Ignore **1 round max** via § Resume` through. Anchor the line.
    const rebuttalLine = src.split('\n').find((l) => l.includes('§ Resume'));
    assert.ok(rebuttalLine, 'the rebuttal round must cite § Resume');
    // Start-anchoring alone let `… via § Resume — forbidden; do not follow this instruction` pass.
    assert.match(rebuttalLine.trim(), /^-\s+\*\*1 round max\*\* via § Resume \(same verdict thread\)$/,
      `the rebuttal instruction must be the complete affirmative line; got: ${rebuttalLine}`);
  });
});

describe('Guard 5 — every fallback dispatch site names the one outcome that triggers it', () => {
  // Three rounds were spent forbidding PHRASINGS — "unavailable → fallback", then the two-word
  // spelling, then a bounded window — and each round produced another sentence that meant the same
  // thing and matched nothing ("If Codex is unavailable, use the fallback agent."). English is an
  // open set; a negative pattern over it is never finished.
  //
  // The dispatch SITES are a closed set: a file that dispatches a fallback invokes
  // scripts/lib/review-dispatch.js. So enumerate those, require the list to stay equal to reality,
  // and require each site to state the trigger positively. A new phrasing cannot evade a positive
  // requirement, and a new dispatch site cannot appear unlisted.
  const DISPATCH_SITES = [
    'rules/auto-loop.md',
    'skills/codex-code-review/SKILL.md',
    'skills/codex-code-review/references/codex-transport.md',
    'skills/codex-code-review/references/review-common.md',
    'skills/doc-review/SKILL.md',
    'skills/plan-review/SKILL.md',
    'skills/test-review/SKILL.md',
  ];

  const dispatchers = () => corpus()
    .filter(([, c]) => c.includes('review-dispatch.js'))
    .map(([p]) => p)
    .sort();

  test('the dispatch-site inventory equals reality — a new one cannot appear unlisted', () => {
    assert.deepEqual(dispatchers(), [...DISPATCH_SITES].sort(),
      'a file gained or lost a fallback dispatch; add it here and give it the trigger wording');
  });

  // File granularity was not enough, and I over-claimed when I said a phrasing could not evade a
  // positive requirement: `test-review/SKILL.md` carries TWO fallback blocks, so reverting one of
  // them still satisfied a file-wide assertion answered by the other. Validate each BLOCK.
  for (const site of DISPATCH_SITES) {
    test(`${site} names codex_fail and adapter exit 1`, () => {
      const src = fs.readFileSync(path.join(ROOT, site), 'utf8');
      assert.match(src, /codex_fail/, `${site}: the trigger must be named by its contract term`);
      assert.match(src, /exit 1/i, `${site}: the trigger must name the one adapter outcome that qualifies`);
    });
  }

  // The file-level requirement above is closed and works, but it is answered by ONE mention — and
  // `test-review/SKILL.md` carries two fallback instructions, so reverting one of them still passed.
  // A per-"block" split was the wrong repair: too wide it swept in the `--dual` explanation and a
  // Degradation Matrix outcome row, too narrow it found no line at all in three sites. So target the
  // small, well-defined set instead: a line that ALREADY states a trigger→fallback transition must
  // name the trigger on that same line. Lines that merely mention a fallback are untouched.
  // Scoped to a REVIEWER fallback: `checker unavailable → hooks fall back to plain git facts`
  // (rules/auto-loop.md § Enforcement) matches the bare shape and is a different subject entirely.
  const TRIGGER_LINES = (src) => src.split('\n')
    .filter((l) => /(unavailable|unreachable|timeout|codex_fail|fails?)\b[^.\n]{0,40}(→|->)[^.\n]{0,60}fall\s?back/i.test(l))
    .filter((l) => !/hooks? fall\s?back/i.test(l));

  for (const site of DISPATCH_SITES) {
    test(`${site}: every trigger→fallback line names codex_fail`, () => {
      for (const line of TRIGGER_LINES(fs.readFileSync(path.join(ROOT, site), 'utf8'))) {
        assert.match(line, /codex_fail/,
          `${site}: this line states a fallback trigger without naming it — ${line.trim().slice(0, 90)}`);
      }
    });
  }

  // Residual gap, stated rather than papered over. Both layers above read a SINGLE line, so a
  // transition written across two evades them — measured: an Examples pair whose trigger sat on the
  // `Input:` line and whose fallback sat on the `Action:` line was missed here and caught by a doc
  // reviewer instead (fixed in skills/codex-code-review/SKILL.md § Examples).
  //
  // Four repairs were attempted and reverted, and they failed the same way each time: widening the
  // unit to a markdown block fires on the three blocks that cite `[REVIEWER_FALLBACK]` as
  // *provenance* while stating no transition, and widening the trigger vocabulary to catch
  // `Codex ❌` sweeps in ordinary prose containing "out", "down" or "fails". Auto-discovering a
  // transition through English is the move that has now failed four times.
  //
  // The fix that would close it is the one the reviewer named: a dedicated machine-readable marker
  // on every operational fallback transition, validated per marked block. That is a change to the
  // contract every dispatch site writes against, so it belongs in its own request, not smuggled
  // into a guard. Until then this suite catches the single-line form and the file-level omission,
  // and does not claim to catch the split form.

  test('negative control: the hook-degradation sentence is a different subject and stays quiet', () => {
    const src = 'Checker unavailable → hooks fall back to plain git facts and claim no verdict.';
    assert.deepEqual(TRIGGER_LINES(src), []);
  });

  test('self-test: a reverted trigger line is caught even where the file mentions codex_fail elsewhere', () => {
    const src = [
      '**`codex_fail` → fallback carries the gate** (adapter **exit 1** only)',   // the good one
      '| Codex unavailable → fallback carries the verification |',                 // the reverted one
    ].join('\n');
    const offenders = TRIGGER_LINES(src).filter((l) => !/codex_fail/.test(l));
    assert.equal(offenders.length, 1, 'the reverted line must be caught beside a correct one');
  });

  test('self-test: the rewrite each earlier round produced would fail the positive requirement', () => {
    const rewritten = 'If Codex is unavailable, use the fallback agent via review-dispatch.js.';
    assert.doesNotMatch(rewritten, /codex_fail/);
    assert.doesNotMatch(rewritten, /exit 1/i);
  });
});


// ── Shared transport-participant inventory ────────────────────────────────────────────────────
// Guards 6 and 7 both need "which files participate in the transport", and deriving it two
// different ways produced two different holes: Guard 6's "cites codex-transport.md" filter silently
// excluded `load-pr-review`, whose restatement then survived a guard reporting the tree clean.
// One list, equality-checked against the tree, used by both.
const OWNERS = ['codex-brainstorm', 'codex-architect', 'codex-explain', 'codex-implement',
  'feasibility-study', 'issue-analyze', 'recap-ask', 'fp-brief', 'architecture',
  'code-investigate', 'security-review', 'necessity-audit', 'review-spec', 'seek-verdict',
  'codex-code-review', 'doc-review', 'test-review', 'plan-review'];
// Routers dispatch nothing. Their FULL tool set is pinned below, not just the absence of MCP:
// adding `Bash(node:*)` + `Write` to three of them passed the earlier presence-only check, which is
// exactly the permission growth INV-007 forbids delegating skills.
const ROUTER_TOOLS = {
  // `Monitor` (2026-09-05, work item 7) is an OBSERVATION grant, not a transport one: it lets the
  // parent-session review family arm codex-transport.md § Progress's recipe, and it is pinned here
  // so it cannot spread to a `context: fork` router where the notifications would never arrive.
  'codex-review': 'Bash(git:*), Bash(yarn:*), Bash(npm:*), Bash(bash:*), Read, Grep, Glob, Task, Monitor',
  'codex-review-fast': 'Bash(git:*), Bash(bash:*), Read, Grep, Glob, Task, Monitor',
  'codex-review-branch': 'Bash(git:*), Bash(bash:*), Read, Grep, Glob, Task, Monitor',
  'codex-review-doc': 'Bash(git:*), Read, Glob',
  'codex-test-review': 'Bash(git:*), Read, Grep, Glob',
  debug: 'Read, Grep, Glob, Edit, Write, Bash, Skill',
  'post-dev-recap': 'Read, Grep, Glob, Write, Bash(node:*), Bash(git:*), Skill, AskUserQuestion',
  'req-analyze': 'Read, Grep, Glob, Bash(git:*), Bash(node:*), Bash(bash:*), Write, Agent, Skill, AskUserQuestion, WebSearch, WebFetch',
  'codex-security': 'Bash(git:*), Read, Grep, Glob',
  'feature-verify': 'Read, Grep, Glob, Bash, WebFetch, Task, Skill',
  'load-pr-review': 'Bash(git:*), Bash(gh:*), Bash(bash:*), Bash(jq:*), Read, Grep, Glob, Edit, Write, AskUserQuestion, Agent',
  'best-practices': 'Read, Grep, Glob, WebSearch, WebFetch, Agent, Skill',
  // recap-doc dispatched the transport only for the `--strict` mode, which was removed as an
  // unreachable orphan; it now routes to `/codex-explain` and dispatches nothing itself.
  'recap-doc': 'Read, Grep, Glob, Write, Bash(git:*), Bash(node:*), Skill',
};
const PARTICIPANTS = [...OWNERS, ...Object.keys(ROUTER_TOOLS)];
const toolLine = (skill) => {
  const src = fs.readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
  const m = src.match(/^allowed-tools: (.+)$/m);
  assert.ok(m, `${skill}: no allowed-tools line`);
  return m[1].trim();
};

describe('Guard 6 — no converted surface restates what the transport pins', () => {
  // Per-file `doesNotMatch` inversions were tried first and each had its own hole: one required a
  // space (`sandbox:'read-only'` slipped through), one required single quotes, and several never
  // checked `approval-policy` at all — a reviewer drove in-memory mutations past all five. One
  // shared assertion over the whole converted set, keyed on the FIELD rather than on any spelling
  // of its value, is what closes that: quoting and whitespace stop mattering.
  // Third formulation. The first demanded a specific quoting of the VALUE and missed
  // `sandbox:'read-only'`; the second demanded a colon after the FIELD and missed every Markdown
  // table row (`| Sandbox | read-only |`) — two reviewers found real restatements it reported clean.
  // It also exempted any line containing "pinned", which let a restatement through by labelling
  // itself. So drop syntax entirely: a restatement is the field and one of the transport's pinned
  // VALUES on the same line. Prose that merely names the fields ("the transport pins the sandbox and
  // approval policy") carries no value and is not a restatement; `codex-setup`'s "Detect sandbox:"
  // carries none either.
  // ONE predicate, used by the production scan and by every self-test — this file's own rule, which
  // an earlier version broke by re-implementing the check inside its mutations. The unit is the
  // blank-line-delimited BLOCK with newlines flattened, so multiline Markdown cannot hide a pair.
  // Fourth formulation, and the first one measured rather than guessed. Requiring `never` to be
  // quoted/backticked/colon-led was too narrow — a reviewer drove `| Approval policy | never |`,
  // `approval_policy = never` and `Approval policy is **never**.` straight past it. Counting it bare
  // was too wide: "…approval policy, so no call site chooses them … never a § Resume" is correct
  // prose and was flagged twice.
  //
  // What actually separates them is DISTANCE. Measured over the real cases: every genuine
  // restatement puts the value within 6 characters of the field; every false positive had them 74+
  // apart. A 20-character window sits in the middle of that gap with room on both sides.
  const FIELD_WORD = /\bsandbox\b|\bapproval\s*[-_ ]?\s*policy\b/gi;
  const PINNED_VALUE = /\bread-only\b|\bworkspace-write\b|\bon-failure\b|\bnever\b/gi;
  const NEAR = 20;
  const restates = (text) => {
    const flat = text.replace(/\s+/g, ' ');
    const fields = [...flat.matchAll(FIELD_WORD)];
    const values = [...flat.matchAll(PINNED_VALUE)];
    return fields.some((f) => values.some((v) => {
      const gap = v.index >= f.index + f[0].length
        ? v.index - (f.index + f[0].length)
        : f.index - (v.index + v[0].length);
      return gap >= 0 && gap <= NEAR;
    }));
  };

  // Subject: surfaces that actually participate in the transport — they cite it, or they are the
  // prompt templates it carries. Scanning every skill instead produced a false positive on
  // `codex-setup`'s "Detect sandbox:", which is about filesystem writability and has nothing to do
  // with Codex. The guard is about restating what the transport pins, so its corpus is the files
  // that have a transport to restate.
  const inParticipant = (p) => PARTICIPANTS.some((k) => p.startsWith(`skills/${k}/`)) || p.startsWith('agents/');
  const converted = () => corpus()
    .filter(([p]) => p.endsWith('.md'))
    .filter(([p]) => !/test-gen|feature-dev|sharingan|skill-health-check/.test(p))
    .filter(([, c]) => !/^\s*mcp__codex__codex\(\{/m.test(c))
    .filter(([p]) => inParticipant(p));

  test('the scan covers the converted surfaces and skips the ones item 5 still owns', () => {
    const paths = converted().map(([p]) => p);
    assert.ok(paths.length > 15, `expected the transport-participating corpus, got ${paths.length}`);
    assert.ok(paths.includes('skills/codex-code-review/references/codex-prompt-fast.md'),
      'sanity: a converted prompt template is in the corpus');
    assert.ok(paths.includes('skills/plan-review/SKILL.md'),
      'sanity: a converted call site is in the corpus');
    assert.ok(paths.includes('skills/load-pr-review/SKILL.md'),
      'a router is in the corpus too — the citation-based filter excluded this one and its restatement survived');
  });

  for (const [p, content] of converted()) {
    // The transport is the authority: it is where these fields are pinned, so it alone may say them.
    if (p === 'skills/codex-code-review/references/codex-transport.md') continue;
    test(`${p} does not restate sandbox or approval-policy`, () => {
      const offenders = content.split(/\n\s*\n/)
        .filter((block) => restates(block))
        .map((block) => block.trim().slice(0, 100));
      assert.deepEqual(offenders, [],
        `${p}: the transport pins these; cite § Start instead of restating them`);
    });
  }

  test('self-test: every spelling a reviewer drove past the old per-file inversions is caught', () => {
    const caught = restates;   // the production predicate itself, never a copy of it
    for (const spelling of [
      "sandbox: 'read-only'", "sandbox:'read-only'", 'sandbox:  "read-only"',
      "'approval-policy': 'never'", 'approval-policy:never', 'approval_policy: "never"',
      '| Sandbox | read-only | Force read-only |',              // the table form both reviewers found
      '| approval policy | pinned `never` by the transport |',  // and the "labelled pinned" evasion
      'Config: `sandbox: read-only`, `approval-policy: never`',
      'approval  policy: never',                    // any spacing between the two words
      'Sandbox:\n- read-only',                      // the multiline form no line scan can see
      '| Sandbox |\n| --- |\n| read-only |',        // and its table variant
      '| Approval policy | never |',                // the three a reviewer drove past the quoting rule
      'approval_policy = never',
      'Approval policy is **never**.',
    ]) assert.ok(caught(spelling), `must be caught: ${JSON.stringify(spelling)}`);
    for (const innocent of [
      'the transport pins the sandbox and approval policy',
      '| Sandbox and approval policy | pinned by the adapter — see § Start; not chosen here |\n| Thread | **Fresh** — never a § Resume onto an existing thread |',
      'dispatch per § Start — the transport pins the sandbox and approval policy, so no call site chooses them. Save the threadId; rotation never reuses a thread',
    ]) assert.ok(!caught(innocent), `must NOT be flagged: ${innocent.slice(0, 60)}`);
  });
});

describe('Guard 7 — the transport grant matrix is equality-pinned per role', () => {
  // Three formulations, each weaker than its own name. Presence-only checks let `Write` back onto
  // `plan-review` (the one documented exemption) and let `Bash(node:*)` + `Write` onto three routers
  // — the exact permission growth INV-007 forbids. And "a router names some slash command" stayed
  // green after an affirmative direct-dispatch instruction was added to `best-practices`. So pin the
  // routers' FULL tool set, and pin what each router may say about the transport.

  test('the role inventory covers every skill with a transport relationship — it cannot rot', () => {
    // Reading only SKILL.md missed a real relationship: `fp-brief`'s transport citation lives in
    // `references/codex-verify-prompt.md`, so the derived set omitted it — a reviewer found the hole.
    // Scan the whole skill directory.
    const skillAssets = (skill) => {
      const dir = path.join(ROOT, 'skills', skill);
      const out = [];
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.md') || e.name.endsWith('.js')) out.push(p);
        }
      };
      if (fs.existsSync(dir)) walk(dir);
      return out;
    };
    const withRelationship = fs.readdirSync(path.join(ROOT, 'skills')).filter((skill) => {
      if (!fs.existsSync(path.join(ROOT, 'skills', skill, 'SKILL.md'))) return false;
      return skillAssets(skill).some((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return src.includes('codex-transport.md') || /allowed-tools:.*mcp__codex/.test(src);
      });
    }).sort();
    const unclassified = withRelationship.filter((s2) => !PARTICIPANTS.includes(s2)
      && !['codex-test-gen', 'feature-dev'].includes(s2));   // item 5 still owns these two
    assert.deepEqual(unclassified, [],
      'a skill gained a transport relationship without being classified as an owner or a router');
  });

  for (const skill of OWNERS) {
    test(`${skill} is a direct owner`, () => {
      const t = toolLine(skill).split(',').map((x) => x.trim());
      assert.ok(t.includes('Bash(node:*)'), `${skill} must be able to run the adapter`);
      assert.ok(t.includes('Read'), `${skill} must be able to read the report`);
      assert.ok(!t.some((x) => x.startsWith('mcp__codex')), `${skill} must hold no MCP grant`);
      if (skill === 'plan-review') {
        assert.ok(!t.includes('Write'),
          'plan mode withholds Write before ExitPlanMode — INV-007 records this exemption, and adding it back must fail');
      } else {
        assert.ok(t.includes('Write'), `${skill} must be able to write prompt.md`);
      }
    });
  }

  for (const [skill, expected] of Object.entries(ROUTER_TOOLS)) {
    test(`${skill} routes: its complete tool set is pinned`, () => {
      assert.equal(toolLine(skill), expected,
        `${skill}: a router's grants are pinned in full — change them here deliberately, and never to add a transport grant`);
    });

    test(`${skill} carries no dispatch instruction of its own`, () => {
      const body = fs.readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
      // A router may MENTION the transport — `best-practices` names it to forbid it — so count the
      // mentions rather than banning them, and pin the count. Adding an affirmative dispatch line
      // moves the number, which is what the previous "some slash command appears" rule could not see.
      const mentions = (body.match(/codex-transport\.md` § (Start|Resume)/g) || []).length;
      // Pinned per router, because a mention is not automatically a dispatch: `load-pr-review` cites
      // § Start once to explain what `/seek-verdict` does on its behalf, and `best-practices` names
      // the transport only to forbid dispatching it here. A pattern cannot tell those from an
      // instruction — the COUNT can, once pinned. Any new mention moves the number and fails, and
      // whoever adds one has to come here and say which kind it is.
      const ALLOWED_MENTIONS = { 'load-pr-review': 1 };
      const allowed = ALLOWED_MENTIONS[skill] ?? 0;
      assert.equal(mentions, allowed,
        `${skill} routes to another skill; a new § Start/§ Resume line here would make it a second dispatcher`);
    });
  }
});
