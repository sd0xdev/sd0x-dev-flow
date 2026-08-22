const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, copyFileSync } = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');

const skillPath = resolve(__dirname, '../../skills/codex-setup/SKILL.md');

function readSkill() {
  assert.ok(existsSync(skillPath), `skills/codex-setup/SKILL.md does not exist at ${skillPath}`);
  return readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
}

function splitSkill(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  assert.ok(match, 'skills/codex-setup/SKILL.md missing YAML frontmatter block');
  return { frontmatter: match[1], body: match[2] };
}

// Return the body of one `## <heading>` section, up to the next `## ` at column 0.
// Assertions are anchored to the section that owns the behaviour so that a stray
// mention elsewhere in the file cannot satisfy a check about `sync` or `doctor`.
// `\Z` is not an anchor in JavaScript — it is a literal `Z`. Both helpers here used to end their
// non-greedy capture at `(?=^## |\Z)`, so every section stopped at the first capital Z after its
// heading rather than at the next heading or the end of the file. Silent, and worst on the
// `doesNotMatch` assertions, which pass trivially on a slice that ends before the text they forbid.
// Found round 80 when a table cell reading "**Zero each**" cut the `sync` section in half.
// `$(?![\s\S])` is the end-of-input anchor JS actually has (`$` under `m` is end-of-LINE).
const SECTION_END = '(?=^## |$(?![\\s\\S]))';

function section(body, heading) {
  const re = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)${SECTION_END}`, 'm');
  const match = body.match(re);
  assert.ok(match, `skills/codex-setup/SKILL.md missing "## ${heading}" section`);
  return match[1];
}

test('the section helper reaches the end of a section, not the first capital Z', () => {
  // A guard on the harness, and it ships with both directions: the fixture that must be cut whole,
  // and a fixture using the same words that must still stop at the next heading.
  const whole = section('## a\nline Zebra\ntail\n', 'a');
  assert.match(whole, /tail/, 'a capital Z inside a section must not truncate it');
  const bounded = section('## a\nZebra\n## b\nother\n', 'a');
  assert.doesNotMatch(bounded, /other/, 'and the next heading must still end it');
});

// `init` has no `## init`-level subsections in the outline sense — Phase 3 is a
// `###` inside it — so phases are extracted separately.
function phase(body, headingPrefix) {
  const re = new RegExp(`^### ${headingPrefix}[^\\n]*$([\\s\\S]*?)(?=^### |^## |$(?![\\s\\S]))`, 'm');
  const match = body.match(re);
  assert.ok(match, `skills/codex-setup/SKILL.md missing "### ${headingPrefix}" phase`);
  return match[1];
}

// ── Opt-in interface ──────────────────────────────────────────────────────────

test('frontmatter description states the pre-push gate is opt-in', () => {
  const { frontmatter } = splitSkill(readSkill());

  assert.match(
    frontmatter,
    /--with-push-gate/,
    'the description is the dispatcher discovery surface and must name the opt-in flag'
  );
  assert.doesNotMatch(
    frontmatter,
    /installs git hooks/,
    'plural "git hooks" implies both are installed by default, which is the claim this change removes'
  );
});

test('the opt-in interface is a flag, and exactly one interface is specified', () => {
  const { body } = splitSkill(readSkill());
  const args = section(body, 'Arguments');

  assert.match(args, /`--with-push-gate`/, 'the opt-in flag must be documented in Arguments');
  assert.match(args, /Off by default/i, 'the flag must be stated as off by default');
  // The request permits a flag *or* a prompt, "擇一寫定" — one, written down. A skill
  // that documented both would leave the non-interactive path undefined.
  assert.match(
    args,
    /no prompt/i,
    'the skill must state that the flag is the interface and no interactive prompt is used'
  );
});

// ── Transition 1: init without opt-in ─────────────────────────────────────────

test('init without the flag installs commit-msg only and reports the skipped gate', () => {
  const { body } = splitSkill(readSkill());
  const install = phase(body, 'Phase 3');

  assert.match(
    install,
    /\|\s*`commit-msg`\s*\|\s*Always\s*\|/,
    'commit-msg must remain an unconditional install'
  );
  // The row and the matrix below it must state ONE contract. An unconditional "only with the
  // flag" here would contradict three matrix rows that write the hook without it (refresh,
  // reinstall, adopt), and an agent could lawfully follow either — leaving an opted-in safety
  // gate missing while both assertions stayed green. The flag governs a *first install*; the
  // matrix governs keeping an existing choice true.
  assert.match(
    install,
    /\|\s*`pre-push`\s*\|\s*With `--with-push-gate`, \*\*or\*\* where the matrix below says so\s*\|/,
    'pre-push must name both the flag and the matrix, not the flag alone'
  );
  assert.match(install, /It is \*\*not\*\* the only thing that writes the\s+hook/,
    'the skill must say outright that the flag is not the sole write path');
  assert.match(install, /with \*\*no\*\* gate to keep/,
    'the do-not-write instruction must be scoped to the case with nothing to preserve');
  assert.doesNotMatch(install, /Only with `--with-push-gate`/,
    'the unconditional phrasing must not survive alongside the matrix that contradicts it');
  assert.match(
    install,
    /not installed \(opt-in\)/,
    'skipping the gate must be reported at the moment it is skipped'
  );
});

// ── Transition 1b: flagless init over an ALREADY-installed gate ───────────────
//
// The one transition the five original cases could not see, because each of them starts
// from a fresh repository. `init` is not only a first-run command — re-running it flagless
// on a gated project must not record a decline the operator never made. The consequence is
// not cosmetic: `doctor` then reads declined × present as a disagreement, and a later plain
// `sync` honours the recorded decline and stops re-copying an installed *safety* hook.

test('init without the flag over an installed gate carries it forward instead of declining', () => {
  const { body } = splitSkill(readSkill());
  const install = phase(body, 'Phase 3');

  assert.match(install, /"[Ss]kipped" is not "declined"/,
    'the skill must distinguish not-installing from recording a decline');
  assert.match(install, /`installed`/,
    'an already-wired gate must be recorded as installed, not overwritten with declined');
  // Classifying is not updating. `sync`'s `unknown → installed` row already re-copies; the
  // same evidence reaching the same conclusion here must reach the same action, or the one
  // place a stale safety hook survives is the flagless re-run on an upgraded project — which
  // is precisely where the wired gate is oldest.
  assert.match(install, /[Rr]e-copy the shipped hook and record the new hash/,
    'resolving to installed must refresh the hook bytes, not merely carry the decision forward');
  // The other half of the same asymmetry, and the one a disk-only table cannot express:
  // `install-state.json` says `installed` but the wiring is gone (hook deleted, Husky file
  // rewritten). Resolving from disk alone answers `declined` — recording an opt-out nobody
  // chose, after which `doctor` reads declined × absent as *healthy* and plain `sync` skips
  // the hook permanently. A previously chosen safety gate is repaired, not quietly dropped.
  assert.match(install, /Recorded `pre-push\.status`/,
    'the decision must read the recorded status, not the disk alone');
  assert.match(install, /[Rr]e-install and record the hash/,
    'a recorded `installed` whose wiring vanished must be repaired');
  assert.match(install, /damage, not a decision/,
    'the skill must say why missing wiring is not read as an opt-out');
  // And the converse must stay protected: a recorded decline is not revisited by a flagless run.
  assert.match(install, /Leave `declined` as it stands/,
    'a recorded decline must survive a flagless init');
  // The resolution must reuse sync's evidence test rather than invent a second one — two
  // rules answering "what is actually wired up" is how the two paths drift apart.
  assert.match(install, /same evidence test `sync` uses for `unknown`/,
    'disk resolution must be stated as the same test sync applies to an unknown entry');

  // And the status table must agree with Phase 3 — a table still reading "init ran without
  // the flag" unconditionally would document the defect as the contract.
  const state = phase(body, 'Phase 5');
  assert.match(state, /no sd0x wiring was found on disk/,
    'the declined row must carry the disk condition, not just the missing flag');

  // Negative control, same words as ordinary data: the flag path is untouched, and the
  // plain skip line must still be there for the genuinely-absent case. Without this, a
  // change that recorded `installed` unconditionally would satisfy every assertion above.
  assert.match(install, /`--with-push-gate` is unaffected/,
    'the opt-in path must remain an unconditional install');
  // Unconditional **install**, conditional **record** — the two halves were once conflated into
  // "installs and records `installed` either way", which contradicted the mode table's
  // every-mode-`pending` contract and put the one status meaning "git runs this hook" on a hook
  // git does not run. Pin the correction positively: a prohibition and its violation contain the
  // same words, so `doesNotMatch` on "records `installed`" would fire on the sentence forbidding it.
  assert.match(install, /the flag says \*install it\*, and the record\s+still says \*what is actually wired up\*/,
    'the flag must decide whether the gate is installed, never what status is recorded');
  assert.match(install, /active → `installed`, not active → `pending`/,
    'the flag path must route through the same activation test as every other path');
  assert.match(install, /not installed \(opt-in\)/,
    'a genuinely absent gate must still be reported as skipped');
});

// ── Transition 2: init with opt-in ────────────────────────────────────────────

test('init with the flag installs the gate through the same mode detection', () => {
  const { body } = splitSkill(readSkill());
  const install = phase(body, 'Phase 3');

  assert.match(install, /`pre-push-gate\.sh`/, 'the gate source script must still be named');
  assert.match(
    install,
    /mode detection is\s*\n?\s*identical for both hooks/,
    'opt-in must change which hooks are installed, not how their install mode is detected'
  );
});

// ── State: explicit status, never inferred from absence ───────────────────────

test('install-state records an explicit status rather than implying it by omission', () => {
  const { body } = splitSkill(readSkill());
  const state = phase(body, 'Phase 5');

  assert.match(state, /"status":\s*"installed"/, 'the installed status must appear in the schema');
  assert.match(state, /"status":\s*"declined"/, 'the declined status must appear in the schema');
  assert.match(
    state,
    /absence never carries meaning/i,
    'the schema must state that a missing field is not a status'
  );
  // Upgrading an existing project must not silently disarm an installed gate.
  assert.match(
    state,
    /read it as `installed`/,
    'a pre-contract entry without a status must read as installed, not declined'
  );
});

// ── Transition 3 + 4: sync in both states ─────────────────────────────────────

test('sync does not install a declined gate and does not remove an installed one', () => {
  const { body } = splitSkill(readSkill());
  const sync = section(body, 'sync');

  assert.match(
    sync,
    /\|\s*`declined`\s*\|\s*not passed\s*\|\s*Skip\./,
    'sync must skip a declined gate when the flag is absent'
  );
  assert.match(
    sync,
    /\|\s*`installed`\s*\|\s*either\s*\|[^|]*Never removed/,
    'sync must not treat a missing flag as a request to uninstall'
  );
  assert.match(
    sync,
    /\|\s*`declined`\s*\|\s*passed\s*\|[^|]*Install now/,
    'passing the flag on sync must be the opt-in path'
  );
  assert.match(
    sync,
    /preserving each hook's `status`/,
    'sync must carry the recorded choice forward into the rewritten state file'
  );
});

// ── Transition 5: doctor in both states ───────────────────────────────────────

test('doctor reports a declined gate as healthy and a missing installed one as failed', () => {
  const { body } = splitSkill(readSkill());
  const doctor = section(body, 'doctor');

  assert.match(
    doctor,
    /\|\s*`declined`\s*\|\s*Absent\s*\|\s*✅ Pass/,
    'a deliberate opt-out must not be reported as a broken install'
  );
  assert.match(
    doctor,
    /\|\s*`installed`\s*\|\s*Absent\s*\|\s*❌ Fail/,
    'an installed hook that vanished is still a failure'
  );
  assert.match(
    doctor,
    /\|\s*`installed`\s*\|\s*\*\*Active\*\*[^|]*\|\s*✅ Pass/,
    'an installed hook passes only where git actually resolves to it'
  );
  assert.match(
    doctor,
    /\|\s*`installed`\s*\|\s*Present but \*\*not active\*\*\s*\|\s*❌ \*\*Fail/,
    'a written-but-inactive hook is a failure — a file git never runs is not a gate'
  );
  assert.doesNotMatch(
    doctor,
    /\|\s*`installed`\s*\|\s*Present\s*\|\s*✅ Pass/,
    'negative control: reverting the disk axis to bare presence must turn this test red'
  );
  assert.match(
    doctor,
    /adds no hook hash verification/,
    'activation is now checked; hash comparison still belongs to AGENTS.md only'
  );
});

test('doctor lists a declined hook rather than omitting its row', () => {
  const { body } = splitSkill(readSkill());
  const doctor = section(body, 'doctor');

  assert.match(
    doctor,
    /listed with its real status rather than omitted/,
    'an operator who did not expect the opt-out must still see the row'
  );
});

// ── Negative control for the section anchoring ────────────────────────────────
// Every assertion above reads one section. If `section()` silently returned the
// whole file, each would still pass on a document that put every claim in the
// wrong place. This case fails in exactly that scenario: `sync`'s section must
// not contain doctor's verdict table, and vice versa.

test('section extraction is scoped — sync and doctor do not read each other', () => {
  const { body } = splitSkill(readSkill());
  const sync = section(body, 'sync');
  const doctor = section(body, 'doctor');

  assert.doesNotMatch(sync, /✅ Pass/, 'the sync section must not contain doctor verdicts');
  assert.doesNotMatch(
    doctor,
    /Re-run `build-codex-artifacts\.js`/,
    'the doctor section must not contain sync steps'
  );
  assert.ok(
    sync.length < body.length && doctor.length < body.length,
    'section() must return a slice, not the whole document'
  );
});

// ── The state machine must agree with itself ──────────────────────────────────
// Three commands read one field, so a rule stated in one section is a claim about
// what the others will do. The tests above pin each section in isolation; these
// pin the seams between them, which is where the contradictions actually lived.

test('the declined trigger does not contradict what sync does with an installed gate', () => {
  const body = splitSkill(readSkill()).body;
  const statusRow = body.match(/^\| `declined` \| Deliberately not installed \|([^|]*)\|/m);
  assert.ok(statusRow, 'the status table must define when `declined` is written');

  // `init`/`sync` ran without the flag" would mean a flagless sync overwrites an
  // installed gate's status — the exact opposite of the sync table's first row,
  // which promises the gate is never removed. Both cannot be followed.
  assert.doesNotMatch(
    statusRow[1],
    /`init`\/`sync` ran without/,
    'a flagless sync must not be listed as writing `declined` over an installed gate'
  );
  assert.match(
    section(body, 'sync'),
    /\| `installed` \| either \|[^|]*Never removed/,
    'sync must still promise an installed gate survives a flagless run'
  );
});

test('an unknown entry with the flag opts in rather than resolving to declined', () => {
  const sync = section(splitSkill(readSkill()).body, 'sync');
  const unknownRows = sync.split('\n').filter((l) => /^\| `unknown`/.test(l));

  // One row for both flag states cannot honour the flag: resolving an absent hook
  // from disk answers `declined`, so `sync --with-push-gate` on a pre-contract
  // state file would silently drop the request it was invoked to carry out.
  assert.equal(unknownRows.length, 2, 'the unknown state must branch on the flag, not ignore it');
  const passed = unknownRows.find((l) => /\|\s*passed\s*\|/.test(l));
  assert.ok(passed, 'one unknown row must cover the flag being passed');
  assert.match(passed, /Install now/, 'with the flag, an unresolved entry installs');
  const notPassed = unknownRows.find((l) => /\|\s*not passed\s*\|/.test(l));
  assert.ok(notPassed, 'one unknown row must cover the flag being absent');
  assert.match(notPassed, /Resolve from disk/, 'without the flag, the entry resolves from disk');

  // Resolving is a classification; it is not the update. A pre-contract state file is the
  // case where the wired hook is oldest, so a row that only relabels leaves stale bytes
  // installed and `doctor` — presence-only by design — passes them. r2 requires that an
  // installed hook keeps being updated, and `unknown → installed` is an installed hook.
  assert.match(notPassed, /re-copy and update the hash/,
    'resolving unknown to installed must perform the installed row s work, not just record it');
  assert.match(notPassed, /do not merely relabel/,
    'the row must say what it is not, or "resolve" reads as bookkeeping alone');
});

test('uninstall names the state entry, not only the hook file', () => {
  const sync = section(splitSkill(readSkill()).body, 'sync');
  const para = sync.slice(sync.indexOf('Uninstalling an installed gate'));
  assert.ok(para, 'sync must document how to uninstall');

  // Deleting the file alone leaves `status: "installed"`, which sync's first row
  // re-copies — the documented procedure would undo itself on the next sync.
  assert.match(para, /`\{"status": "declined"\}`/, 'uninstall must set the state entry too');
  assert.match(para, /re-copies/, 'the reason the file alone is insufficient must be stated');
  assert.doesNotMatch(
    para,
    /resolves the now-absent hook through the\s*\n?`unknown` row/,
    'an installed entry never reaches the unknown row'
  );
});

// ── `pending` is a state with an exit ─────────────────────────────────────────

test('pending has a transition out of it in both init and sync', () => {
  // Phase 3 writes `pending` when a hook file exists in the fallback dir and git does not
  // resolve to it. That is a claim about the disk awaiting one operator command — not a
  // choice. Before this pin, `init` and `sync` had rows for `installed`, `unknown` and
  // `declined` only, so once the operator ran the printed remedy nothing ever promoted the
  // entry: `doctor` went on failing a gate that fires. A valid persisted state with no
  // transition out is a defect the state table itself cannot show.
  const { body } = splitSkill(readSkill());

  for (const heading of ['init', 'sync']) {
    // init's status × disk transition table lives in Phase 3, beside the mode table it reads;
    // Phase 5 only describes the schema each status is written into.
    const text = heading === 'init' ? phase(body, 'Phase 3') : section(body, 'sync');
    assert.match(text, /^\|\s*`pending`\s*\|/m,
      `${heading} must define what happens to a recorded \`pending\` entry`);
    assert.match(text, /`pending`[\s\S]{0,400}?re-resolve activation/i,
      `${heading}'s pending row must re-resolve activation rather than relabel the entry`);
  }

  // Pin the prohibition itself rather than pattern-matching for its violation: a regex over
  // prose cannot tell a rule from its negation — both contain the word — so `doesNotMatch` here
  // would fire on the very sentence that forbids the thing. Deleting this sentence turns the
  // test red, which is what the control is for.
  const init = phase(body, 'Phase 3');
  const pendingRow = init.match(/^\|\s*`pending`\s*\|[^\n]*$/m);
  assert.ok(pendingRow, 'init must carry a `pending` row');
  assert.match(pendingRow[0], /never a decline|must not write `declined`/,
    'a flagless init writing `declined` over `pending` would state an opt-out the operator never '
    + 'made — the same failure the `installed` rows exist to prevent, so the row must say so');
});

test('the flagless-decline prose and the transition table agree on what counts as no gate to keep', () => {
  // The table was fixed first and the sentence introducing it was not, so the two disagreed on
  // exactly one combination: `pending` × absent wiring. The prose said "no recorded `installed`,
  // nothing sd0x-owned on disk → decline", which admits `pending`; the table's own row says
  // re-copy and re-resolve. Prose that precedes a table is read as its summary, so a reader who
  // stops there declines a gate the operator had already opted into — and a table cannot pin the
  // sentence that misdescribes it.
  const { body } = splitSkill(readSkill());
  const init = phase(body, 'Phase 3');
  const prose = init.match(/So: without the flag[\s\S]*?Record the choice in Phase 5/);
  assert.ok(prose, 'the flagless-decline paragraph must remain findable ahead of the table');
  assert.match(prose[0], /no recorded opt-in of any kind/,
    'the decline condition must be stated as "no opt-in", not as "no recorded `installed`"');
  assert.match(prose[0], /`pending` is an opt-in whose wiring never finished/,
    'and it must name `pending` explicitly — it is the combination the two versions disagreed on');

  // Negative control, both directions. Restoring the narrow wording must fail the assertions
  // above, and a paragraph that keeps the correct rule while merely mentioning `installed`
  // elsewhere must stay green — otherwise this is a word ban rather than a claim pin.
  const narrowed = prose[0]
    .replace(/the recorded status is absent or `unknown`,\n?/, 'no recorded `installed`, ')
    .replace(/"No gate to keep" means \*\*no recorded opt-in of any kind\*\*[\s\S]*?declines\.\s*/, '');
  assert.notEqual(narrowed, prose[0], 'the narrowing fixture must actually differ from the prose');
  assert.doesNotMatch(narrowed, /no recorded opt-in of any kind/,
    'the narrow wording must fail the opt-in assertion, or the pin proves nothing');

  const embellished = `${prose[0]}\n(An entry recorded \`installed\` follows its own row above.)`;
  assert.match(embellished, /no recorded opt-in of any kind/,
    'an added sentence mentioning `installed` must not break correctly worded prose');
});

test('doctor splits pending by activation instead of failing it unconditionally', () => {
  // The remedy working must be visible. `pending` × active means git resolves to the hook and
  // the gate fires; reporting that as ❌ Fail is false, and a check that cries wolf on a working
  // guard is a check operators learn to skip.
  const doctor = section(splitSkill(readSkill()).body, 'doctor');

  assert.match(doctor, /\|\s*`pending`\s*\|\s*\*\*Not active\*\*\s*\|\s*❌/,
    'a written-but-inactive hook must still fail — this is the direction the state exists for');
  assert.match(doctor, /\|\s*`pending`\s*\|\s*\*\*Active\*\*\s*\|\s*⚠️/,
    'an activated hook whose state file is merely stale must not read as broken');
  assert.doesNotMatch(doctor, /\|\s*`pending`\s*\|\s*Either\s*\|/,
    'negative control: collapsing the two disk states back into `Either` must turn this test red');
});

test('the subcommand advertisement and the doctor section agree on what doctor verifies', () => {
  // `doctor` was advertised as "files exist + hash match" while its own section verifies
  // activation and says in as many words that it adds no hook hash verification. The
  // Subcommands row is what an operator reads when choosing which command to run, so that is
  // where the overclaim does its damage: it promises byte integrity for a safety hook whose
  // bytes doctor never compares, and a stale gate then reads as a verified one.
  const { body } = splitSkill(readSkill());
  const subcommands = section(body, 'Subcommands');
  const row = subcommands.match(/^\| `doctor` \|[^\n]*$/m);
  assert.ok(row, 'the Subcommands table must keep a `doctor` row');

  assert.match(row[0], /\*\*active\*\*/,
    'the row must name activation — the axis doctor actually evaluates');
  assert.match(row[0], /bytes\*? are `sync`'s axis/,
    'and it must name the command that does own the byte comparison it stopped promising');

  const doctor = section(body, 'doctor');
  assert.match(doctor, /stale or\s+locally edited bytes passes `doctor`/,
    'doctor must state the residual its narrower promise leaves, not merely stop claiming it');

  // Negative control, both directions. The pre-fix wording must fail the row assertions, and a
  // reworded but equivalent row must stay green — otherwise this pins a sentence, not a claim.
  const overclaimed = '| `doctor` | Verify installation integrity (files exist + hash match) |';
  assert.doesNotMatch(overclaimed, /\*\*active\*\*/,
    'the pre-fix advertisement must fail the activation assertion, or the pin proves nothing');
  const reworded = row[0].replace('each recorded hook is', 'every recorded hook is');
  assert.notEqual(reworded, row[0], 'the rewording fixture must actually differ from the row');
  assert.match(reworded, /\*\*active\*\*/,
    'an unrelated rewording of the same claim must stay green');
});

test('every install mode defines both an active and an inactive persisted state', () => {
  // The mode table once read `1–3 (git runs the written file)` beside a separate `Husky` row,
  // while the priority table above it makes Husky priority 1 — two rows claiming mode 1. The
  // same table left modes 1–3 with `—` for the inactive case, which is not "cannot happen":
  // mode 2's core.hooksPath can point elsewhere and mode 3's hook can be shadowed. An
  // activation failure there reached a state the schema has no value for.
  const phase3 = phase(splitSkill(readSkill()).body, 'Phase 3');

  const rows = phase3.split('\n').filter((l) => /^\|\s*\d\s*\(/.test(l));
  assert.equal(rows.length, 4, 'the mode table must carry exactly one row per numbered mode');

  for (const n of [1, 2, 3, 4]) {
    const row = rows.find((l) => new RegExp(`^\\|\\s*${n}\\s*\\(`).test(l));
    assert.ok(row, `mode ${n} must have its own row`);
    assert.match(row, /`installed`/, `mode ${n} must say what an active install records`);
    assert.match(row, /`pending`/,
      `mode ${n} must record a persisted state when the hook is written but not active — `
      + 'an em dash there leaves the state machine undefined for a reachable outcome');
  }

  assert.match(rows.find((l) => /^\|\s*1\s*\(/.test(l)), /Husky/,
    'mode 1 is Husky per the priority table — the numbering must not disagree with itself');

  // Negative control: the .githooks remedy belongs to mode 4 and would break every Husky hook
  // if printed for mode 1, so it must not appear in mode 1's row.
  assert.doesNotMatch(rows.find((l) => /^\|\s*1\s*\(/.test(l)), /core\.hooksPath \.githooks/,
    'the .githooks remedy in the Husky row would disable every Husky hook in the repository');
});

// ── round 34: the Husky stanza is a runnable contract, not a paragraph ────────

// The stanza the skill tells the installer to write, taken from the document itself. If it stops
// being a single `sh` fence between the markers, that is the failure — not something to recover
// from by loosening the extraction.
function huskyStanza() {
  const m = readSkill().match(/```sh\n(# >>> sd0x-dev-flow pre-push gate >>>[\s\S]*?# <<< sd0x-dev-flow pre-push gate <<<)\n```/);
  assert.ok(m, 'the Husky stanza must stay one marker-delimited sh fence — it is what the installer writes');
  return m[1];
}

// The outer shell of the stanza runs with the pusher's whole environment, so every construct in
// it must be one an exported `BASH_FUNC_name%%` cannot answer. Rather than forbid the words that
// were wrong last round — a list that is only ever complete about the past — this classifies every
// logical line against a closed set of permitted shapes. A construct nobody thought of fails by
// not being on the list, which is the direction that survives the next idea.
const PERMITTED_OUTER_LINES = [
  // the two privileged children, and the operand line that completes the second
  /^__sd0x_refs=\$\(\/usr\/bin\/env( -u [A-Za-z0-9_]+)+ \\$/,
  /^\/usr\/bin\/env( -u [A-Za-z0-9_]+)+ \\$/,
  /^\/bin\/bash -p -c '.*'\)?\s*\\?$/,
  /^sd0x-pre-push \.\/\.claude\/scripts\/pre-push-gate\.sh "\$__sd0x_refs" "\$@"$/,
  /^__sd0x_rc=\$\?$/,
  // the two decisions and the two refusals — reserved words and expansion only
  /^case "\$__sd0x_(refs|rc)" in$/,
  /^esac$/,
  /^__sd0x_abort=''$/,
  /^: "\$\{__sd0x_abort:\?[^}]*\}"$/,
  // the two stated residuals: neither decides anything, and a shadowed one cannot open a gate
  /^exec 0< "\$__sd0x_refs"$/,
  /^rm -f "\$__sd0x_refs"$/,
];

function outerLines(stanza) {
  return stanza.split('\n')
    .map((l) => l.replace(/\s+#.*$/, '').trim())   // trailing commentary is not a construct
    .filter((l) => l !== '' && !l.startsWith('#'))
    // A `case` arm label and its `;;` are grammar, not commands. Strip them and classify what
    // they guard, so the list below stays a list of CONSTRUCTS rather than of line layouts.
    .map((l) => l.replace(/^[^\s()]*\)\s*/, '').replace(/\s*;;$/, '').trim())
    .filter((l) => l !== '');
}

function unpermitted(stanza) {
  return outerLines(stanza).filter((l) => !PERMITTED_OUTER_LINES.some((re) => re.test(l)));
}

test('the Husky stanza reaches the gate only through constructs an imported function cannot answer', () => {
  const stanza = huskyStanza();
  // Round 35, P0. The stanza this replaces resolved the gate with `git rev-parse`, guarded with
  // `[ -r ]`, captured with `cat`, launched with `bash` and refused with `exit` — five bare
  // command words in front of a gate whose whole purpose is to be un-bypassable. Measured
  // 2026-08-21: `BASH_FUNC_git%%` pointed the guard at a path that does not exist, and a
  // protected rewrite landed with exit 0. The behavioural pair below witnesses both directions.
  assert.deepEqual(unpermitted(stanza), [],
    'every line of the stanza must be a permitted construct: an absolute path, a `bash -p` child, '
    + '`case`, an assignment, or a `${x:?}` abort');

  // Positive presence, so the closure cannot be satisfied by an empty stanza.
  assert.match(stanza, /\/usr\/bin\/env /,
    'the entry point must be an ABSOLUTE path — bash refuses to import a function whose name contains a slash');
  assert.match(stanza, /\/bin\/bash -p -c /,
    'the real work must happen inside `bash -p`, which imports no BASH_FUNC_* and reads no BASH_ENV');
  assert.match(stanza, /: "\$\{__sd0x_abort:\?/,
    'refusal must be a `${x:?}` expansion — it fails before command lookup, where `exit` does not');
  assert.match(stanza, /-u SD0X_PRIV_REEXEC/,
    "an inherited privileged-mode marker would make the gate skip its own re-exec — the caller must not hand one down");

  // Prepend, not append: git delivers the ref list on stdin ONCE.
  assert.match(readSkill(), /\| 1 \| `\.husky\/` directory exists \|[^|]*\*\*then prepend\*\*[^|]*`pre-push-gate\.sh`[^|]*`\.husky\/pre-push`/,
    'the priority table must say prepend, and must name where the gate goes — appending puts the '
    + 'gate behind whatever already drains stdin');
  // Order, not mere presence: reversed, the rest of the hook inherits a closed descriptor.
  const iExec = stanza.indexOf('exec 0<');
  const iRm = stanza.indexOf('rm -f');
  assert.ok(iExec > 0 && iRm > 0, 'the stanza must both re-open and unlink the capture file');
  assert.ok(iExec < iRm, 'the capture file must be re-opened on fd 0 BEFORE it is unlinked');

  // Negative control: a classifier that accepts everything would look identical above.
  assert.deepEqual(unpermitted('__sd0x_gate="$(git rev-parse --show-toplevel)/x"'),
    ['__sd0x_gate="$(git rev-parse --show-toplevel)/x"'],
    'the classifier must reject the very construct this round removed');
  assert.deepEqual(unpermitted('bash "$__sd0x_gate" "$@" < "$__sd0x_refs"'),
    ['bash "$__sd0x_gate" "$@" < "$__sd0x_refs"'],
    'the classifier must reject a bare interpreter word');
});

// ── the commit-msg stanza — the hook a FLAGLESS init installs ────────────────
//
// `commit-msg` is the default install (r2 AC: `init` installs it, `pre-push` is opt-in), so under
// Husky it is the path a project hits without asking for anything. It had no written-out stanza at
// all while the push gate — the opt-in one — had a fully specified one: the default route was the
// undefined one.

function commitMsgStanza() {
  const m = readSkill().match(/```sh\n(# >>> sd0x-dev-flow commit-msg guard >>>[\s\S]*?# <<< sd0x-dev-flow commit-msg guard <<<)\n```/);
  assert.ok(m, 'the commit-msg stanza must stay one marker-delimited sh fence — it is what the installer writes');
  return m[1];
}

// Same closed-set discipline as the push stanza, and a DIFFERENT list on purpose: this hook is
// handed a path, not a stream, so the capture, the hand-back and the unlink have no business here.
// Permitting them would let the two stanzas drift into each other's shape unnoticed.
const PERMITTED_CM_LINES = [
  /^\/usr\/bin\/env( -u [A-Za-z0-9_]+)+ \\$/,
  /^\/bin\/bash -p -c '.*'\s*\\?$/,
  /^sd0x-commit-msg \.\/\.claude\/scripts\/commit-msg-guard\.sh "\$@"$/,
  /^__sd0x_cm_rc=\$\?$/,
  /^case "\$__sd0x_cm_rc" in$/,
  /^esac$/,
  /^__sd0x_cm_abort=''$/,
  /^: "\$\{__sd0x_cm_abort:\?[^}]*\}"$/,
];

const unpermittedCm = (stanza) =>
  outerLines(stanza).filter((l) => !PERMITTED_CM_LINES.some((re) => re.test(l)));

test('the Husky commit-msg stanza reaches the guard only through constructs an imported function cannot answer', () => {
  const stanza = commitMsgStanza();
  assert.deepEqual(unpermittedCm(stanza), [],
    'every line must be a permitted construct: an absolute path, a `bash -p` child, `case`, '
    + 'an assignment, or a `${x:?}` abort');

  assert.match(stanza, /\/usr\/bin\/env /,
    'the entry point must be an ABSOLUTE path — a bare `env` is shadowable by an imported function');
  assert.match(stanza, /\/bin\/bash -p -c /,
    'the real work must happen inside `bash -p`, which imports no BASH_FUNC_* and reads no BASH_ENV');
  assert.match(stanza, /: "\$\{__sd0x_cm_abort:\?/,
    'refusal must be a `${x:?}` expansion — `exit` is a builtin and answerable');
  assert.match(stanza, /-u SD0X_PRIV_REEXEC/,
    'the guard establishes privileged mode through that marker; an inherited one makes it skip its own re-exec');

  // What must NOT be carried over. The push stanza's apparatus exists for a one-shot stdin stream
  // that this hook does not get, and a copied `exec 0<` would reopen fd 0 over a file this stanza
  // never created.
  assert.doesNotMatch(stanza, /exec 0</,
    'commit-msg is handed a path, not a stream — there is no captured file to hand back');
  assert.doesNotMatch(stanza, /mktemp|rm -f/,
    'nothing is captured, so nothing is left to unlink');
  // ALLOW_AI_COAUTHOR is the attribution anchor's narrow opt-in; the guard decides what it may do,
  // and a stanza that stripped it would silently change that contract from outside.
  assert.doesNotMatch(stanza, /-u ALLOW_AI_COAUTHOR/,
    'the stanza must not unset the opt-in the guard itself is responsible for interpreting');

  // Negative control: a classifier that accepts everything would look identical above.
  assert.deepEqual(unpermittedCm('bash .claude/scripts/commit-msg-guard.sh "$1"'),
    ['bash .claude/scripts/commit-msg-guard.sh "$1"'],
    'the classifier must reject a bare interpreter word');
  assert.deepEqual(unpermittedCm('exit "$__sd0x_cm_rc"'), ['exit "$__sd0x_cm_rc"'],
    'the classifier must reject a shadowable `exit` as the refusal');

  // And the table must route the default hook here, or the stanza is documentation nobody reaches.
  assert.match(readSkill(), /\| 1 \| `\.husky\/` directory exists \|[^|]*`commit-msg-guard\.sh`[^|]*`\.husky\/commit-msg`/,
    'the Husky row must name where the default hook goes — that omission is what left the flagless '
    + 'init with no defined path on a Husky project');
});

test('the Husky commit-msg stanza when run → refuses an AI trailer and passes an ordinary message', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-husky-cm-'));
  mkdirSync(resolve(dir, '.claude/scripts'), { recursive: true });
  copyFileSync(resolve(__dirname, '../../scripts/commit-msg-guard.sh'),
    resolve(dir, '.claude/scripts/commit-msg-guard.sh'));

  // The hook shape Husky produces: the stanza prepended, the project's own hook after it.
  const hook = resolve(dir, 'commit-msg');
  writeFileSync(hook, ['#!/bin/sh', 'set -e', commitMsgStanza(),
    'echo "TAIL-RAN" >&2'].join('\n') + '\n');
  chmodSync(hook, 0o755);

  const run = (body) => {
    const msg = resolve(dir, 'COMMIT_EDITMSG');
    writeFileSync(msg, body);
    const r = spawnSync(hook, ['COMMIT_EDITMSG'],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, ALLOW_AI_COAUTHOR: '' } });
    return { status: r.status, err: r.stderr || '' };
  };

  const refused = run('feat: x\n\nCo-Authored-By: Claude <someone@example.com>\n');
  assert.notEqual(refused.status, 0,
    'a forbidden attribution trailer must stop the commit — this is the anchor the default hook exists for');
  assert.doesNotMatch(refused.err, /TAIL-RAN/,
    'the refusal must stop the hook, not merely print — a stanza that falls through commits anyway');

  // The negative control. Without it this test is satisfied by a stanza that refuses everything,
  // which is a broken hook that looks exactly as green on the day it lands.
  const passed = run('feat: x\n\nAn ordinary message that mentions Claude in prose.\n');
  assert.equal(passed.status, 0,
    `an ordinary message must commit: ${passed.err}`);
  assert.match(passed.err, /TAIL-RAN/,
    "and the project's own hook must still run after the guard passes");

  // The third branch, and the one the fixture used to hide by always copying the guard in:
  // `test -r "$1" || exit 0`. A repository whose guard is not installed must fall THROUGH — the
  // stanza is prepended to hooks that predate it, so aborting here would block every commit in a
  // project that never opted in. What matters is that it is a fall-through and not a silent abort,
  // which is why the tail is asserted: both outcomes leave `status` at 0 for the trailer message,
  // and only `TAIL-RAN` tells them apart.
  rmSync(resolve(dir, '.claude/scripts/commit-msg-guard.sh'));
  const absent = run('feat: x\n\nCo-Authored-By: Claude <someone@example.com>\n');
  assert.equal(absent.status, 0,
    `an uninstalled guard must not block the commit: ${absent.err}`);
  assert.match(absent.err, /TAIL-RAN/,
    "and the project's own hook must still run — the stanza skips itself, it does not short-circuit the hook");

  rmSync(dir, { recursive: true, force: true });
});

// One temp repo, reused: building it costs a git init and the gate is read-only over it.
function stanzaHarness() {
  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-husky-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q');
  mkdirSync(resolve(dir, '.claude/scripts'), { recursive: true });
  copyFileSync(resolve(__dirname, '../../scripts/pre-push-gate.sh'),
    resolve(dir, '.claude/scripts/pre-push-gate.sh'));
  return dir;
}

// `tail` is the project's own hook, standing in for whatever already lives in `.husky/pre-push`.
// It reports how many ref lines reached it, which is the half a pass/fail cannot show.
function runHook(dir, stanza, refLine, { tail = true, env, shebang = '#!/bin/sh' } = {}) {
  const hook = resolve(dir, 'hook.sh');
  writeFileSync(hook, [shebang, 'set -e', stanza,
    ...(tail ? ['n=0', 'while read -r a b c d; do n=$((n+1)); done', 'echo "TAIL-SAW $n" >&2'] : []),
  ].join('\n') + '\n');
  chmodSync(hook, 0o755);
  const r = spawnSync(hook, ['origin', 'https://example.invalid/r.git'],
    { cwd: dir, input: refLine + '\n', encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
  return { status: r.status, err: r.stderr || '' };
}

const REWRITE = 'refs/heads/main 1111111111111111111111111111111111111111 '
  + 'refs/heads/main 2222222222222222222222222222222222222222';
const CREATE = 'refs/heads/feat/x 0000000000000000000000000000000000000000 '
  + 'refs/heads/feat/x 3333333333333333333333333333333333333333';

test('the documented stanza when run → the gate still sees the refs, and so does the hook below it', () => {
  const dir = stanzaHarness();
  try {
    const stanza = huskyStanza();
    // The gate's own verdict must survive being wrapped. A protected rewrite is the case that
    // fails silently when it goes wrong, so it is the one asserted on.
    const blocked = runHook(dir, stanza, REWRITE);
    assert.notEqual(blocked.status, 0,
      `the wrapped gate must still refuse a protected rewrite; stderr: ${blocked.err}`);

    // And the half that a pass/fail alone hides: the project's own hook is not starved. Without
    // the hand-back this assertion reads TAIL-SAW 0 while everything else stays green.
    const passed = runHook(dir, stanza, CREATE);
    assert.equal(passed.status, 0, `an ordinary create must pass; stderr: ${passed.err}`);
    assert.match(passed.err, /TAIL-SAW 1/,
      `the rest of the hook must still receive git's one-shot ref stream; stderr: ${passed.err}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the stanza when appended behind a stdin consumer → the fail-open this contract exists to stop', () => {
  // The negative control for the test above, and it is not hypothetical: it is what "append
  // sourcing" produced. If this ever passes-as-refused, the assertion above proves nothing,
  // because a harness that cannot reproduce the defect cannot witness the fix either.
  const dir = stanzaHarness();
  try {
    const drained = ['n=0', 'while read -r a b c d; do n=$((n+1)); done', huskyStanza()].join('\n');
    const r = runHook(dir, drained, REWRITE, { tail: false });
    assert.equal(r.status, 0,
      'precondition: a consumer ahead of the gate starves it, and the gate then allows the rewrite — '
      + 'this is the measured fail-open, so it must reproduce here');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A `pre-push` hook runs with the environment of whoever ran `git push`, so an exported
// `BASH_FUNC_name%%` is imported as a shell function before the hook's first line. Every bare
// command word in front of the gate is therefore the pusher's to define — which is exactly what
// the gate closes for ITSELF with its privileged re-exec, and exactly what the wrapper around it
// must not reopen.
const HOSTILE_FUNCTIONS = {
  // each of these answered a decision the previous stanza made
  'BASH_FUNC_git%%': '() { echo /definitely-missing; }',   // resolved the gate to a path that is not there
  'BASH_FUNC_cat%%': '() { :; }',                          // discarded the ref stream
  'BASH_FUNC_bash%%': '() { return 0; }',                  // never launched the gate, reported success
  'BASH_FUNC_mktemp%%': '() { echo /dev/null; }',
  'BASH_FUNC_test%%': '() { return 1; }',
  'BASH_FUNC_exec%%': '() { return 0; }',                  // a BUILTIN, and still shadowable
  'BASH_FUNC_exit%%': '() { return 0; }',                  // so the refusal path was a no-op too
};

// `#!/bin/bash` rather than the `#!/bin/sh` the other cases use, and the reason is the test's own
// validity: whether `/bin/sh` imports `BASH_FUNC_*` depends on what `/bin/sh` actually IS —
// bash on macOS, dash on most Linux. Left unpinned, this pair silently becomes vacuous on half the
// platforms it is meant to protect, and a vacuous test is indistinguishable from a passing one.
const HOSTILE_SHELL = { env: HOSTILE_FUNCTIONS, shebang: '#!/bin/bash' };

test('the documented stanza when the pusher exports hostile shell functions → the gate still refuses', () => {
  const dir = stanzaHarness();
  try {
    const blocked = runHook(dir, huskyStanza(), REWRITE, HOSTILE_SHELL);
    assert.notEqual(blocked.status, 0,
      `a protected rewrite must be refused even when git, cat, bash, mktemp, test, exec and exit `
      + `are all the pusher's functions; stderr: ${blocked.err}`);

    // And the honest path is unchanged: a create still passes. Without this half, "refuses
    // everything" would score as a pass.
    const passed = runHook(dir, huskyStanza(), CREATE, HOSTILE_SHELL);
    assert.equal(passed.status, 0, `an ordinary create must still pass; stderr: ${passed.err}`);
    // TAIL-SAW **0**, and asserted rather than omitted, because it is the residual the document
    // states: handing stdin back needs a redirection, redirection needs `exec`, and `exec` is a
    // builtin the pusher can shadow. There is no POSIX construct that reopens fd 0 without it.
    // What that costs is bounded and is not this gate: OUR decision has already been made and
    // enforced (the refusal above), and what degrades is the PROJECT's own hook, which now reads
    // an empty stream. Pinning the 0 keeps the document and the code saying the same thing — if a
    // future stanza ever does hand it back under these conditions, this line is where that is
    // noticed rather than quietly assumed.
    assert.match(passed.err, /TAIL-SAW 0/,
      `the documented residual: a shadowed \`exec\` starves the hook below, after our gate has `
      + `already decided; stderr: ${passed.err}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the stanza this replaced, under the same hostile environment → the fail-open it was measured to have', () => {
  // The negative control for the test above. This is the stanza shipped in round 34, verbatim: it
  // resolved the gate with `git rev-parse`, guarded with `[ -r ]`, captured with `cat`, launched
  // with `bash` and refused with `exit`. Measured 2026-08-21 against a real remote, the protected
  // rewrite landed with exit 0 and `* [new branch] main -> main`.
  //
  // If this ever stops reproducing, the assertion above proves nothing — a harness that cannot
  // witness the defect cannot witness the fix.
  const dir = stanzaHarness();
  try {
    const previous = [
      '# >>> sd0x-dev-flow pre-push gate >>>',
      '__sd0x_gate="$(git rev-parse --show-toplevel)/.claude/scripts/pre-push-gate.sh"',
      'if [ -r "$__sd0x_gate" ]; then',
      '  __sd0x_refs=$(mktemp) || exit 1',
      '  cat > "$__sd0x_refs"',
      '  __sd0x_rc=0',
      '  bash "$__sd0x_gate" "$@" < "$__sd0x_refs" || __sd0x_rc=$?',
      '  exec 0< "$__sd0x_refs"',
      '  rm -f "$__sd0x_refs"',
      '  [ "$__sd0x_rc" -eq 0 ] || exit "$__sd0x_rc"',
      'fi',
      '# <<< sd0x-dev-flow pre-push gate <<<',
    ].join('\n');
    const r = runHook(dir, previous, REWRITE, { ...HOSTILE_SHELL, tail: false });
    assert.equal(r.status, 0,
      'precondition: with the pusher owning every command word, the previous stanza let a protected '
      + `rewrite through — this is the measured P0, so it must reproduce here; stderr: ${r.err}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── The Husky Active predicate names each hook's OWN script ───────────────────
// Round 42. The row hard-coded `pre-push-gate.sh`, which survived only while `pre-push` was the
// sole hook with a Husky path. The existing static tests all passed over it, because they asserted
// the row's *shape* and a hard-coded name is shaped exactly like a correct one. The defect breaks
// in both directions on the default install: a flagless `init` ships `commit-msg` and deliberately
// no gate, so a working attribution guard reads `pending`; and a repo still carrying a stale
// `pre-push-gate.sh` reads `commit-msg` as `installed` after `commit-msg-guard.sh` was deleted —
// `doctor` green over commits that never run the guard.
function huskyActiveRow() {
  const row = readSkill().split('\n').find((l) => /^\| 1 \(Husky\) \|/.test(l));
  assert.ok(row, 'precondition: the mode table still carries a `1 (Husky)` row');
  return row;
}

test('the Husky Active predicate → resolves the guarded script per hook, not by one hard-coded name', () => {
  const row = huskyActiveRow();

  // The predicate must be parameterized, and both mappings must be stated. A row naming only one
  // script is the defect whichever script it names.
  assert.match(row, /\$script/,
    'the predicate must test `.claude/scripts/$script`, not a fixed filename');
  assert.match(row, /`commit-msg-guard\.sh` for `commit-msg`/,
    'the commit-msg hook must be mapped to its own guard');
  assert.match(row, /`pre-push-gate\.sh` for `pre-push`/,
    'the pre-push hook must be mapped to the gate');

  // Negative control — both directions of the hard-code the fix removed. Without these the three
  // assertions above are satisfied by a row that merely mentions the names in prose.
  const hardCodedGate = '| 1 (Husky) | `test -x "$resolved"` and `test -r '
    + '"$repo_root/.claude/scripts/pre-push-gate.sh"` | `installed` | pending |';
  assert.doesNotMatch(hardCodedGate, /\$script/,
    'the old gate-only row named no variable — the check above must be able to see that');
  const hardCodedGuard = hardCodedGate.replace(/pre-push-gate\.sh/g, 'commit-msg-guard.sh');
  assert.doesNotMatch(hardCodedGuard, /\$script/,
    'hard-coding the OTHER script is the same defect — the check must reject it too');
});

// ── Dedicated-file modes must not clobber a foreign hook ──────────────────────

// The ownership predicate is read OUT OF the skill, never restated here. A test that hard-codes the
// marker stays green while Phase 3 says something else — which is the one failure this pair exists
// to catch, since the install would then refuse to refresh our own file and say nothing about why.
// Phase 3's `sd0x-owned` row carries all three parts: the marker template, the window it may appear
// in, and the scripts it is instantiated for.
function parseOwnershipRow(row) {
  const tpl = row.match(/is exactly `([^`]*<script>[^`]*)`/);
  assert.ok(tpl, 'the sd0x-owned row must state the marker as a literal containing `<script>`');
  const window = row.match(/first (\d+) lines/);
  assert.ok(window, 'and it must state how many leading lines the marker may appear in');
  const scripts = [...row.matchAll(/`([A-Za-z0-9._-]+\.sh)`/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2, 'and it must name the scripts the marker is instantiated for');
  return { marker: (script) => tpl[1].replace('<script>', script), headLines: Number(window[1]), scripts };
}

function ownershipContract() {
  const install = phase(splitSkill(readSkill()).body, 'Phase 3');
  const row = install.split('\n').find((l) => l.startsWith('| **sd0x-owned**'));
  assert.ok(row, 'Phase 3 must carry an sd0x-owned row for the ownership predicate to be read from');
  return { ...parseOwnershipRow(row), row, install };
}

test('a dedicated-file hook write is classified by content before it happens', () => {
  // **Round 58's C4.** Modes 2–4 write the hook *as* the file, and Phase 3 said nothing about what
  // was already at that path — so `--with-push-gate` on a project with its own `pre-push` deleted
  // that hook to install ours. Irreversible, and done in the name of adding a guard.
  const install = phase(splitSkill(readSkill()).body, 'Phase 3');
  assert.match(install, /Do not write/,
    'Phase 3 must name a destination it refuses to write, or the classification decides nothing');
  // `\s+` rather than a literal space: the phrase is wrapped across two lines in the source, and a
  // test that breaks on rewrapping tests the line width rather than the rule.
  assert.match(install, /by content, never by\s+existence/,
    'and the predicate must be content-based — a file existing says nothing about who owns it');
  assert.match(install, /pending/,
    'a refused write must still record the opt-in, or a later sync reads it as a decline');

  // The three outcomes must be exhaustive and distinct: absent → write, sd0x-owned → overwrite,
  // anything else → refuse. Two of the three would leave the third silently taking a default.
  for (const outcome of [/Absent/, /sd0x-owned/, /Anything else/]) {
    assert.match(install, outcome, `Phase 3 must classify the ${outcome} destination`);
  }

  // Negative control: the same assertions must fail on the text as it stood before the fix. Without
  // this, a Phase 3 that merely mentions "pending" somewhere satisfies the check.
  const before = install.replace(/#### Modes 2–4[\s\S]*?(?=#### )/, '');
  assert.notEqual(before, install, 'the mutation must actually remove the ownership section');
  assert.doesNotMatch(before, /Do not write/,
    'the pre-fix text must fail the refusal assertion — otherwise it guards nothing');
});

test('the ownership marker the skill names → is actually in both shipped scripts', () => {
  // The predicate is only as good as the line it looks for. If a script's header is reworded, the
  // install starts refusing every refresh of our own file — the safe direction, but silently, and
  // this is the check that turns it into a red test instead of a support ticket.
  const { marker, headLines, scripts, row } = ownershipContract();
  assert.deepEqual(scripts, ['pre-push-gate.sh', 'commit-msg-guard.sh'],
    'Phase 3 must name exactly the two hooks this skill installs');
  for (const script of scripts) {
    const src = resolve(__dirname, '../../scripts/', script);
    assert.ok(existsSync(src), `${script} must exist to be the file the marker describes`);
    const head = readFileSync(src, 'utf8').split('\n').slice(0, headLines);
    assert.ok(head.some((l) => l.startsWith(marker(script))),
      `${script} carries no "${marker(script)}" line in its first ${headLines} lines, so the ` +
      'ownership predicate in Phase 3 would refuse to overwrite our own installed copy');
  }

  // Negative control 1: the predicate must not match a script it does not name. Without this the
  // assertion above is satisfied by any prefix test loose enough to match everything.
  const gate = readFileSync(resolve(__dirname, '../../scripts/pre-push-gate.sh'), 'utf8')
    .split('\n').slice(0, headLines);
  assert.ok(!gate.some((l) => l.startsWith(marker('commit-msg-guard.sh'))),
    'the gate must not match the guard marker, or the predicate cannot tell the two hooks apart');
  assert.ok(!gate.some((l) => l.startsWith(marker('some-users-own-hook.sh'))),
    'and it must not match a foreign script name, which is the whole point of the check');

  // Negative control 2 — on the coupling itself. Re-parse the row with the marker reworded: if the
  // extraction is live, the skill's new wording is what gets tested and nothing matches. A
  // hard-coded marker would sail through this unchanged, which is exactly what it must not do.
  const reworded = row.replace(marker('<script>'), '# owned-by-<script>: ');
  assert.notEqual(reworded, row, 'the mutation must actually reword the marker in the row');
  const mutant = parseOwnershipRow(reworded);
  assert.ok(!gate.some((l) => l.startsWith(mutant.marker('pre-push-gate.sh'))),
    'a skill stating a different marker must fail this test — proving the marker is read from ' +
    'Phase 3 rather than restated in the test file');
});

// ── Modes 2–4: identity is not ownership (round 60) ───────────────────────────

function modeRow(prefix) {
  const row = readSkill().split('\n').find((l) => l.startsWith(prefix));
  assert.ok(row, `precondition: the mode table still carries a "${prefix}…" row`);
  return row;
}

test('the modes 2–4 Active predicate → requires ownership, not only identity and executability', () => {
  // `-ef` asks whether the resolved file is the file at the written path. After Phase 3 refuses
  // to clobber a foreign hook those are the SAME file, so the two old tests both pass and the
  // refusal promotes itself to `installed`.
  const two = modeRow('| 2 (`core.hooksPath` set) |');
  assert.match(two, /-ef/, 'identity is still required — the new test adds to it, never replaces it');
  assert.match(two, /test -x/, 'and so is executability');
  assert.match(two, /sd0x-owned/,
    'ownership must be part of the activation predicate, not only of the write-time classification');

  for (const prefix of ['| 3 (`.git/hooks/` direct) |', '| 4 (fallback dir) |']) {
    assert.match(modeRow(prefix), /same three tests/,
      `${prefix} inherits the predicate by reference, so it must inherit all three parts`);
  }

  // Negative controls — the pre-fix rows, both shapes. Without them the assertions above are
  // satisfied by any row that mentions the word somewhere.
  const beforeTwo = '| 2 (`core.hooksPath` set) | `test "$resolved" -ef "$written_path"` '
    + '**and** `test -x "$resolved"` | `installed` | pending |';
  assert.doesNotMatch(beforeTwo, /sd0x-owned/,
    'the two-test row must fail the ownership assertion, or the pin proves nothing');
  assert.doesNotMatch('| 3 (`.git/hooks/` direct) | same two tests | `installed` | pending |',
    /same three tests/, 'and "same two tests" must not satisfy the inheritance assertion');
});

test('a foreign hook git actually runs → terminal pending, and never a re-copy', () => {
  const row = modeRow('| 2–4, **foreign collision**');
  assert.match(row, /not\*{0,2} sd0x-owned/, 'the row must name the condition it classifies');
  assert.match(row, /terminal/i, 'and say that this pending has no automatic transition out');
  assert.match(row, /[Dd]o not re-copy/,
    'because the re-copy would be exactly the clobber the original refusal prevented');
  assert.match(row, /[Mm]ove or rename/, 'the remedy is the operator\'s, so it must be printed');
  assert.doesNotMatch(row, /\|\s*`installed`\s*\|/,
    'and no column may record `installed` — that promotion is the defect being closed');
});

test('a pending re-copy is classified before it happens, in both init and sync', () => {
  const rows = readSkill().split('\n').filter((l) => l.startsWith('| `pending` | either |'));
  assert.equal(rows.length, 2, 'init and sync each carry exactly one pending transition row');
  for (const row of rows) {
    assert.match(row, /sd0x-owned/,
      'a re-copy is a write, so § Phase 3 content classification governs it too');
    assert.match(row, /terminal/i,
      'and the foreign destination must be named as the outcome with no transition out');
  }

  // Negative control: the pre-fix row re-copied unconditionally.
  const before = '| `pending` | either | Re-copy and update the hash, then **re-resolve '
    + 'activation** (§ Phase 3 mode table): active → `installed` |';
  assert.doesNotMatch(before, /sd0x-owned/,
    'the unconditional re-copy row must fail this check, or it pins nothing');
});

test('the pending definition and the doctor row both cover the foreign case', () => {
  const lines = readSkill().split('\n');
  const def = lines.find((l) => l.startsWith('| `pending` | The opt-in happened'));
  assert.ok(def, 'the state table must define `pending` by what is true on disk');
  assert.match(def, /not ours/, 'the definition must admit the case where git runs somebody else\'s hook');
  assert.match(def, /terminal/i, 'and mark it as the one with no automatic remedy');

  const doctor = section(splitSkill(readSkill()).body, 'doctor');
  const notActive = doctor.split('\n').find((l) => l.startsWith('| `pending` | **Not active** |'));
  assert.ok(notActive, 'doctor must keep its pending × not-active row');
  assert.match(notActive, /foreign/i,
    'doctor must distinguish "nothing fires" from "something fires and it is not the gate"');
  assert.match(notActive, /[Mm]ove or rename/, 'and print the remedy that case actually has');

  const active = doctor.split('\n').find((l) => l.startsWith('| `pending` | **Active** |'));
  assert.ok(active, 'doctor must keep its pending × active row');
  assert.match(active, /ownership included|sd0x-owned/,
    'the Active axis must say it means active AS THE GATE, or a foreign hook lands in the warn row');
});

test('a refused write, measured → the two old tests pass on a foreign hook; ownership is what refuses', () => {
  // The executable half. Everything above reads the document; this builds the exact state Phase 3
  // leaves behind — a real repository whose `pre-push` is somebody else's — and measures both
  // predicates against it.
  const { marker, headLines } = ownershipContract();
  const dir = mkdtempSync(resolve(tmpdir(), 'codex-setup-foreign-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    const rel = execFileSync('git', ['-C', dir, 'rev-parse', '--git-path', 'hooks/pre-push'],
      { encoding: 'utf8' }).trim();
    const hook = resolve(dir, rel);

    writeFileSync(hook, '#!/bin/sh\n# the project\'s own pre-push checks\nexit 0\n');
    chmodSync(hook, 0o755);

    // Mode 3: git resolves to exactly the path a write would have targeted — so `$resolved` and
    // `$written_path` are one file and the old predicate is satisfied by a hook that is not ours.
    const old = spawnSync('/bin/sh', ['-c', 'test "$1" -ef "$2" && test -x "$1"', 'sh', hook, hook]);
    assert.equal(old.status, 0,
      'the pre-fix predicate passes on a foreign hook — this measurement is the defect');

    const head = () => readFileSync(hook, 'utf8').split('\n').slice(0, headLines);
    assert.ok(!head().some((l) => l.startsWith(marker('pre-push-gate.sh'))),
      'and the ownership predicate is the only one of the three that tells them apart');

    // Positive control: our own gate at the same path must still read as active. A predicate that
    // refuses everything would satisfy the assertion above and break every real installation.
    copyFileSync(resolve(__dirname, '../../scripts/pre-push-gate.sh'), hook);
    chmodSync(hook, 0o755);
    const ours = spawnSync('/bin/sh', ['-c', 'test "$1" -ef "$2" && test -x "$1"', 'sh', hook, hook]);
    assert.equal(ours.status, 0, 'identity and executability still hold for our own copy');
    assert.ok(head().some((l) => l.startsWith(marker('pre-push-gate.sh'))),
      'and ownership holds too, so an installed gate is still recorded `installed`');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round 79: sync's "re-copy" names one artifact, and Husky wiring is two ────

test('sync accounts for the Husky stanza, not only the copied script', () => {
  // In modes 2–4 the sd0x wiring IS `.claude/scripts/<script>`, so "re-copy and update the hash"
  // is complete. In mode 1 the other half is the stanza inside `.husky/<hook>`, and a stanza that
  // disagrees with the gate beside it is the one combination where sync leaves the repository
  // worse than it found it: the gate refuses to be sourced, so a re-copied gate under a legacy
  // sourcing wrapper fails every push. The `unknown` row already refuses stale SCRIPT bytes; this
  // is the same sentence owed to the stanza.
  const sync = section(splitSkill(readSkill()).body, 'sync');

  assert.match(sync, /\.husky\/<hook>/,
    'sync must say what happens to the Husky container, not only to the copied script');

  // Replace in place, and say why re-prepending is not the same thing — a second stanza does not
  // supersede the first, it runs after it.
  assert.match(sync, /[Rr]eplace that block in place/,
    'an existing marker pair must be replaced where it is, keeping the rest of the file');
  assert.match(sync, /two gates|both gates|older one still runs/i,
    'and the reason re-prepending is wrong must be stated, or the shorter form reads as equivalent');

  // The legacy case is the one this branch actually creates: before this contract the skill said
  // only "Append sourcing to Husky hooks", so those installs have NO markers to bound. It is
  // evidence of an install, so it must not resolve to `declined`; it has no boundary, so it must
  // not be edited either.
  assert.match(sync, /not\*{0,2} a decline|is \*\*not\*\* a decline/,
    'a legacy sourcing line is evidence of a prior install and must not read as an opt-out');
  const legacyRow = sync.split('\n').find((l) => l.includes('from before markers existed'));
  assert.ok(legacyRow, 'the legacy row must state the remedy the operator has to apply by hand');
  assert.match(legacyRow, /`pending`/,
    'and record pending — the file\'s own word for "opted in, wiring unfinished"');
  assert.doesNotMatch(legacyRow, /`declined`/,
    'never declined, which would drop an opt-in the operator made');

  // An unreadable boundary refuses rather than guessing, in the same direction as the
  // foreign-collision row. Round 79: the message phrase alone was the whole assertion, and it
  // survived a mutation that deleted "an opening without its closing". Round 80: the enumeration
  // that replaced it was itself mis-shaped — it listed "a closing before its opening" under a
  // selector reading "any other marker COUNT", which that example does not differ by. The contract
  // is now a procedure, and what these assertions pin is that each question is asked separately.
  const refuseRow = sync.split('\n').find((l) => l.includes('Terminal refuse'));
  assert.ok(refuseRow, 'the malformed-marker step must still exist');
  assert.match(refuseRow, /duplicated, unbalanced, out of order or empty/,
    'the reported message must name every repair the step can be reached by');

  const steps = sync.split('\n').filter((l) => /^\| [1-5] \|/.test(l));
  assert.equal(steps.length, 5, `the procedure must still have five steps, found ${steps.length}`);

  // Step 1 counts. It must NOT also decide order — one of each in the wrong order has the same
  // counts as a well-formed pair, so a count-only step sends it to the replace arm.
  assert.match(steps[0], /[Oo]ne each/, 'step 1 must route the one-each case onward, not decide it');
  assert.match(steps[0], /[Zz]ero each/, 'and name the zero-marker case explicitly');
  assert.match(steps[0], /one of one kind and none of the other|two or more of either/i,
    'and send every other count to the refusal');
  assert.doesNotMatch(steps[0], /before its opening|order/i,
    'ordering is step 2 — asking it here is what made the previous table not a partition');

  // Step 2 asks the two questions counting cannot: order, and whether the block runs anything.
  assert.match(steps[1], /intact sd0x block/i, 'step 2 must test intactness, not marker balance');
  assert.match(steps[1], /closing before opening|opening first/i,
    'ordering must be decided here');
  assert.match(steps[1], /invokes? nothing|invoke this hook's script/i,
    'and an emptied block must fall to the refusal, not be replaced as if it were live');

  // Step 3 is the one the round-80 review reached: a mere textual mention is not wiring.
  assert.match(steps[2], /\*\*non-comment\*\*/,
    'step 3 must exclude comments, or a documented path turns a clean install into a refusal');
  assert.match(sync, /is documentation|not "wiring"|not \*\*wiring\*\*/i,
    'and the reason must be stated, since the narrower test is the surprising one');
  assert.match(sync, /first character `#`/,
    'with the test written out — "non-comment" without a rule is not implementable');

  // Negative control on that narrowing, using the same words as the data: the coarse direction must
  // stay coarse. A test that simply required "a live `.`/`source` command" would let a path named
  // in any other live form through, and the surviving source line fails every push in silence.
  assert.match(sync, /coarse in the safe direction|still counts as wiring/i,
    'the deliberate over-inclusion of live commands must be stated, not quietly narrowed');

  // The boundary must be the SAME one uninstall uses; two boundaries would be two contracts.
  const body = splitSkill(readSkill()).body;
  assert.match(body, /# >>> sd0x-dev-flow pre-push gate >>>/,
    'the marker the stanza opens with must still be written out somewhere in the file');
  assert.match(sync, /marker/i, 'and sync must name the marker pair as the boundary it reads');
});

test('`commit-msg` is exempt from the opt-in table, not from the marker procedure', () => {
  // Round 80. The file said `commit-msg` is "unaffected by the matrix above", which read as an
  // exemption from the wiring procedure rather than from the opt-in/decline states. Mode 1 gives it
  // the same two artifacts, and the legacy installer appended sourcing to Husky hooks generally —
  // so a legacy `commit-msg` wrapper is not merely possible, it is the shape that shipped.
  const sync = section(splitSkill(readSkill()).body, 'sync');
  const para = sync.slice(sync.indexOf('`commit-msg`'));
  assert.ok(para.length > 0, 'sync must still say what happens to commit-msg');
  assert.match(para, /runs this same procedure/i,
    'commit-msg must be inside the marker procedure, not excluded from it');
  assert.match(para, /opt-in table|always installed/i,
    'and what it IS exempt from must be named, or the sentence just flips the old error');

  // The reason it needs the procedure more, not less — and this is the asymmetry a reader would
  // otherwise have to reconstruct from two sections.
  assert.match(para, /replaces the sourcing shell|`exec`s/i,
    'sourcing the guard replaces the parent shell — a strictly worse failure than the gate\'s');
  assert.match(para, /silently|stops running/i,
    'and that it is silent, which is why re-copying under the wrapper is not a fix');

  // Negative control: the status sentence must survive. It is about the RECORD, and the round-80
  // rewrite is about the ACTION — a test that only demanded the new words would pass on a
  // paragraph that dropped the activation-test rule this file states nowhere else in full.
  assert.match(para, /Phase 3 activation test/,
    'the record rule must stay: no path records `installed` without running the activation test');
});

test('the intact-block definition states all three clauses, in one place', () => {
  // Three tests can record `installed` (sync step 2, the `unknown` row, the mode-1 Active
  // predicate). Round 79 narrowed one of them to marker balance and the other two followed;
  // round 80's review found a balanced-but-empty block certifying a gate that runs nothing. One
  // definition is what keeps the three from drifting apart again.
  const body = splitSkill(readSkill()).body;
  const at = body.indexOf('**Definition — an `intact sd0x block`');
  assert.notEqual(at, -1, 'the definition must still exist under that name');
  const def = body.slice(at);
  const table = def.slice(0, def.indexOf('\n\n', def.indexOf('|--')));

  assert.match(table, /[Ee]xactly one opening marker and exactly one closing marker/,
    'clause 1: counts');
  assert.match(table, /opening precedes the closing/i, 'clause 2: order');
  assert.match(table, /lines \*\*between\*\* them invoke/i, 'clause 3: the body runs this hook\'s script');
  assert.match(table, /commit-msg-guard\.sh/,
    'and "this hook\'s script" must be resolved, or the clause passes on the other hook\'s gate');

  // Negative control, same words as the data: presence must remain a documented, usable probe.
  // Deleting it would be an easy way to make every assertion above vacuously safe, and it would
  // also break `doctor`, whose reports legitimately say "sd0x stanza present".
  assert.match(def, /presence/i,
    'the opening-marker probe must still be described as what it is, not removed');
});

test('no path that records `installed` decides Husky presence from the opening marker alone', () => {
  // Round 79. `doctor`'s presence probe greps for the opening marker, and two other places said
  // "sd0x stanza present" while meaning that probe: the `unknown` row's disk-evidence test and the
  // mode-1 Active predicate. A truncated stanza satisfies both, so each would certify `installed`
  // over exactly the file § sync's marker matrix answers with a terminal `pending`.
  const body = splitSkill(readSkill()).body;

  // The probe itself stays what it is — it is named as a probe, which is what stops the next
  // reader from promoting it back into a verdict.
  const probeRow = body.split('\n').find((l) => l.includes("doctor`'s \"sd0x stanza present\" test"));
  assert.ok(probeRow, 'the marker row must still describe how presence is detected');
  assert.match(probeRow, /presence/i, 'and must say the opening-marker grep is only that');

  for (const [needle, what] of [
    ['sd0x integration evidence', 'the `unknown` row resolving a pre-contract state file'],
    ['reaches the sourcing container', 'the mode-1 Active predicate'],
  ]) {
    const row = body.split('\n').find((l) => l.includes(needle));
    assert.ok(row, `${what} must still exist`);
    assert.match(row, /intact sd0x block/,
      `${what} must read the whole block, not the opening marker: ${row.slice(0, 80)}`);
  }

  // Negative control, using the same words as ordinary data: "sd0x stanza present" must still be
  // usable as prose — the two `doctor` remedies at the mode table say it, and they are reports
  // about a hook that failed a different clause, not presence decisions. A test banning the phrase
  // outright would be green today and would fail the next honest use.
  assert.ok(body.split('\n').filter((l) => /sd0x stanza present in \$written_path/.test(l)).length >= 1,
    'the doctor remedy messages must keep saying it — the ban is on deciding by it, not on saying it');
});
