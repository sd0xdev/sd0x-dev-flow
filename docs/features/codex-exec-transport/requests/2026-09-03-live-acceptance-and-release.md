# Live acceptance and release

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-09-03
> **Status**: In Progress
> **Note**: Work item 6 of 6 in the tech spec's § 5. Items 1, 3 and 4 each carry a narrow live smoke run for their own slice; this is the one ticket dedicated to the complete consuming-project acceptance (auto-install, protocol mismatch, profile paths) and the release evidence — the live JSONL schema cannot be exercised by the fake CLI, so this run closes the feature, then the version bump.
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- § 6 Testing Strategy — Acceptance bullet; § 7 Open Questions
> **Depends On**: [Permission, README and catalog sweep](./2026-09-03-permission-readme-and-catalog-sweep.md)
> **Intent**: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md) <- Acceptance sketch is the script

## Background

Items 1–5 are each verified by fake-CLI tests and by the review loop reviewing its own change.
What no automated test can prove is the live contract: the real `thread.started` event, the real
`-o` file, a real `protocol_mismatch` against an installed copy, and the consuming-project
auto-install path. This ticket runs the intent's acceptance sketch for real and records it.

## Requirements

- In a throwaway consuming project with the plugin loaded and no `.claude/scripts/codex-exec.js`:
  a `/codex-review-fast` auto-installs the adapter, dispatches `start`, re-reviews with `resume`
  on the same `threadId`, cleans up; the transcript shows the control records.
- Plant an adapter with a different protocol constant in `.claude/scripts/`: the run prints
  `[CODEX_EXEC_CONFIG] code=protocol_mismatch`, exits 2, dispatches no fallback, and the operator
  instruction names `/install-scripts codex-exec.js --force`.
- Set `## Codex Profile` to a name with no profile-v2 file: exit 2 `profile_missing`, no dispatch;
  then to an existing profile: `requestedProfile` appears in the record.
- Answer spec § 7: whether `codex-plugin-fallback` keeps its Degradation Matrix place (proposal:
  unchanged), and whether a release watch on `codex mcp-server` is wanted (default: no).
- `/bump-version minor`; the release notes name the transport change and the setup change.

## Scope

| Scope | Description |
| ----- | ----------- |
| In | The live acceptance runs, their record in this ticket, the two § 7 decisions, the version bump |
| Out | Any code or prose fix the acceptance uncovers — that reopens the owning ticket (1–5), never lands here |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `package.json`, `.claude-plugin/plugin.json`, `.sd0x/install-state.json` | Modify | `/bump-version minor` |
| `docs/features/codex-exec-transport/2-tech-spec.md` | Modify | § 7 answers appended as decisions; § 4 risk table gains the measured live-schema note |
| This ticket | Modify | Progress carries the thread ids, exit codes and timestamps of every run |

## Acceptance Criteria

- [x] **Consuming-project run, 2026-09-04, codex-cli 0.149.0.** A throwaway git repo with no
  `.claude/`, and the plugin present only as a marketplace cache copy at
  `<home>/.claude/plugins/cache/sd0xdev-marketplace/sd0x-dev-flow/4.5.0/scripts/codex-exec.js`.
  Locator step 1 missed. **Step 2 did not match, and finding out why was the most valuable result of
  this run**: the shipped glob was `plugins/**/sd0x-dev-flow/scripts/codex-exec.js`, which requires
  `scripts` to be an immediate child of the plugin directory, and a marketplace cache interposes a
  version segment. Measured with `fs.globSync` over all three layouts, with a positive control:
  `marketplaces/<m>/plugins/<plugin>/scripts/…` matched, `cache/<m>/<plugin>/scripts/…` matched,
  `cache/<m>/<plugin>/<version>/scripts/…` returned `[]`. What resolved the adapter in this run was
  a `find` fallback, not the documented cascade. Per this ticket's Scope Out row the fix reopened its
  owning item — the locator in `codex-transport.md` § Locator now globs
  `plugins/**/sd0x-dev-flow/**/scripts/codex-exec.js` and treats multiple matches as an ambiguity to
  surface rather than guess (recorded in item 2). With that, the adapter was copied to
  `.claude/scripts/codex-exec.js` (destination absent, so the skip-on-conflict rule did not apply).
  **An acceptance run that certifies its own evidence is worthless; this one earned its keep by
  failing.**
  `start` → `{"protocol":1,"threadId":"01a06d06-c244-7180-9053-61d6948d074f","reportFile":"…/codex-exec-HlXADN/report.md","requestedProfile":null,"class":"review"}`, exit 0;
  the report carried `✅ Ready` / `gate_reason=NONE`, derived from the real file at `-o`.
  `resume --thread-id 01a06d06-…` on the revised tree returned **the same id**, exit 0, and its
  report referred back to the first turn (*"The prior review identified no issues; the revised
  zero-divisor guard works…"*) — live thread continuity, which no fake CLI can demonstrate.
  Both scratch dirs were `0700` with `prompt.md` and `report.md` at `0600`; `cleanup` removed each
  and exited 0, and `cleanup /tmp` was refused with `[CODEX_EXEC_USAGE] code=invalid_dir`, exit 2
- [x] **`protocol_mismatch`.** The installed adapter's constant was changed to `2` and the call
  still passed `--protocol 1`: `[CODEX_EXEC_CONFIG] code=protocol_mismatch expected=2 received=1`,
  **exit 2**. No child was spawned and no `[REVIEWER_FALLBACK]` was emitted — correctly, since exit
  2 is a configuration error and dispatches nothing (`codex-transport.md` § Completion state
  machine). The prescribed remedy is `/sd0x-dev-flow:install-scripts codex-exec.js --force`
  (that reference's remediation table); restoring the good copy returned exit 0 on the next `alloc`
- [x] **Profile, both directions.** `--profile no-such-profile-xyz` →
  `[CODEX_EXEC_CONFIG] code=profile_missing profile=no-such-profile-xyz`, **exit 2**, and the report
  file was never written — nothing was dispatched. With the profile-v2 file that exists on this
  machine (`$CODEX_HOME/cli.config.toml`), `--profile cli` → exit 0 with
  `"requestedProfile":"cli"` in the control record, thread `01a06d08-cb1b-7f51-b8c7-ff373fc4b70b`
- [x] Both decided and dated in `2-tech-spec.md` § 7: **item 1 unchanged** (the two features are
  orthogonal — primary transport versus fallback carrier — and nothing in this change touched the
  matrix ordering), **item 3 no watcher** (it would watch a command this plugin no longer calls;
  what actually needs watching is `codex exec`'s own contract, and every dispatch does that, since a
  breaking change surfaces as adapter exit 1 with a diagnostic). Item 2 was closed by item 4. § 4's
  live-schema risk row now records the measurement instead of the assumption
- [x] `4.5.0` → **`4.6.0`** in `package.json`, `.claude-plugin/plugin.json` and
  `.sd0x/install-state.json` — one string, all three files (the manifest included, which is what
  stops the SessionStart drift sentinel firing after a bump)
- [ ] **Blocked on your approval, not on work.** This AC needs commits to exist and to be pushed:
  `release.yml` generates the notes from the commit subjects between the previous tag and the bump,
  so there is nothing to inspect until the change is committed and pushed. Committing needs
  `/smart-commit --execute` and pushing needs `/push-ci`, each with an explicit per-use approval
  (Anchor Register #4). **Nothing is committed.** The suggested subjects, which are what the notes
  would say, are drafted in Progress below
- [ ] `/codex-review-doc` — **unchecked on purpose, and it cannot be checked here.** Writing this
  row is an edit to a file the doc batch owns, so it moves the doc digest and re-opens the plane:
  any tick would claim a verdict for the digest it is itself creating. The last verdict obtained was
  `⛔ Needs revision` from `contract-neutral-reviewer`, carrying the gate under
  `[REVIEWER_FALLBACK] plane=doc_review from=codex to=contract-neutral-reviewer reason=quota` after
  the adapter exited 1 on a Codex account usage limit — its report validated with
  `[SENTINEL_VALID] contract=doc`, and its one blocking finding was **this AC**, checked with
  exactly the claim this paragraph now refuses to make. The gate closes on the next pass at the
  resulting digest and not before
- [x] `/precommit` — `## Overall: ✅ PASS` at code-plane digest `sha256:e4ced391…`, self-noted by
  the runner; `/codex-review-fast` returned `✅ Ready` on the same code plane and is noted at that
  digest too (the version bump touches code-plane files, so the code gate is owed here as well as
  the two this ticket names)

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Script = the intent's acceptance sketch; spike on 2026-09-03 already showed live `start`/`resume` continuity outside a consuming project |
| Development | Done | `/bump-version minor` → 4.6.0 across the three files; § 7 items 1 and 3 decided in the spec; § 4's live-schema risk row rewritten around the measurement |
| Testing | Done | Five live runs against codex-cli 0.149.0, all recorded above with their ids and exit codes: auto-install + `start`, `resume` on the same thread, `protocol_mismatch` (exit 2), `profile_missing` (exit 2, nothing dispatched), valid `--profile cli` (`requestedProfile` in the record), plus `cleanup` accepting an alloc dir and refusing `/tmp` |
| Acceptance | In Progress | **Two ACs are unchecked.** (1) Release notes — blocked on a user approval this workflow cannot give itself: it needs a commit and a push, each with an explicit per-use approval (Anchor Register #4), and nothing is committed. (2) `/codex-review-doc` — structurally uncheckable from inside a file the doc batch owns, since writing the tick re-opens the plane; see that AC. **Closed and checked**: `/codex-review-fast` `✅ Ready` and `/precommit` `## Overall: ✅ PASS`, both at code-plane digest `sha256:e4ced391…`, both noted. The header keeps the bare `In Progress` token — status is parsed from it |

### Live run ledger (2026-09-04, codex-cli 0.149.0)

| Run | Command | Result |
|-----|---------|--------|
| 1 | `alloc` (consuming project, adapter auto-installed from the cache) | dir `codex-exec-HlXADN`, `0700`; files `0600` |
| 2 | `start --class review` | exit 0, thread `01a06d06-c244-7180-9053-61d6948d074f`, report `✅ Ready` |
| 3 | `resume --thread-id 01a06d06-…` | exit 0, **same id**, report refers back to turn 1 |
| 4 | `alloc` with a protocol-2 adapter, `--protocol 1` | exit 2, `code=protocol_mismatch expected=2 received=1`, no dispatch |
| 5 | `start --profile no-such-profile-xyz` | exit 2, `code=profile_missing`, no report written |
| 6 | `start --profile cli` | exit 0, `"requestedProfile":"cli"`, thread `01a06d08-cb1b-7f51-b8c7-ff373fc4b70b` |
| 7 | `cleanup <alloc dir>` ×4, then `cleanup /tmp` | exit 0 each; `/tmp` refused with `code=invalid_dir`, exit 2 |

### Deferred findings from the fallback doc review (2026-09-04)

`contract-neutral-reviewer` carried the doc gate when Codex hit its account usage limit. Its
blocking finding was fixed (the `/codex-review-doc` AC above); these are its sub-threshold rows,
logged and passed per `@rules/auto-loop.md` § Sub-Threshold Findings. **All five** sit in files other
than this ticket — two in item 4's record, two in item 5's, and one in the intent, which is not a
ticket at all — so each is a correction to that document, not to this one:

```
[NIT_DEFERRED] requests/2026-09-03-non-gate-skills-transport-switch.md:14 | "Nineteen skills" contradicts that ticket's own twenty-skill Scope In row and gives no counting predicate | reason: sub-threshold-Nit | 2026-09-04T15:59:33Z
[NIT_DEFERRED] requests/2026-09-03-non-gate-skills-transport-switch.md:73 | "39 surfaces across 24 skills" exceeds the declared 21 in-scope skills with no stated basis | reason: sub-threshold-Nit | 2026-09-04T15:59:33Z
[NIT_DEFERRED] requests/2026-09-03-permission-readme-and-catalog-sweep.md:56 | Scope Out excludes prompt changes, but item 3 handed codex-prompt-test-gen.md's conversion to that item and the tree shows it converted there | reason: sub-threshold-Nit | 2026-09-04T15:59:33Z
[NIT_DEFERRED] requests/2026-09-03-permission-readme-and-catalog-sweep.md:73 | an AC quotes a README sentence that differs from the shipped text; the substantive claim verifies | reason: sub-threshold-Nit | 2026-09-04T15:59:33Z
[NIT_DEFERRED] intent-codex-exec-transport.md:35 | INV-003's exit-0 biconditional omits the "report still exactly 0600" conjunct that 2-tech-spec.md requires | reason: sub-threshold-Nit | 2026-09-04T15:59:33Z
```

The first two are the counting-predicate class this feature has now been caught by twice — and the
paragraph that introduced this list was caught by it a third time, saying "three" of five and "two
records" of three files. The burndown ticket's numbers are the model the reviewer named: each
verifies against a stated grep. Fixing the five here would edit three documents this ticket does not
own, which is why they are recorded rather than swept.

### Fallback code review (2026-09-04) — verdict and its deferrals

Codex was out of quota for this round on both planes, so the contract-aware carriers ran:
`[REVIEWER_FALLBACK] plane=code_review from=codex to=strict-reviewer reason=quota` and
`[REVIEWER_FALLBACK] plane=doc_review from=codex to=contract-neutral-reviewer reason=quota`. Both
raw reports passed `scripts/validate-family-sentinel.js` for their family, so each verdict is a real
gate verdict with `gate_source=fallback:<agent>` (`@rules/auto-loop.md` § Review Dispatch), not
advisory. The code carrier returned `✅ Ready` / `gate_reason=NONE` with two sub-threshold rows:

```
[NIT_DEFERRED] scripts/codex-exec.js:25 | a trailing valueless --profile makes the parser assign undefined, and the `!== undefined` guard then skips validation, so the run proceeds on Codex's default configuration; the control record still reports requestedProfile=null truthfully and the documented choreography never emits the bare flag | reason: sub-threshold-Nit | 2026-09-04T16:26:25Z
[NIT_DEFERRED] skills/codex-code-review/references/review-common.md:162 | ${DISPOSITIONS} lost its 'None' fallback when the block was converted, so the ordinary no-dispositions case renders an empty heading | reason: sub-threshold-Nit | 2026-09-04T16:26:25Z
```

Both belong to items 1 and 3 rather than to this ticket, and both are below the blocking line at
`thorough`. The carrier's out-of-scope finding — the same one-sided plugin glob at five sites in
three files — is recorded in item 2 beside the § Locator fix, since that is the item that owns the
class.

### Suggested commit subjects (drafted, not executed)

`release.yml` turns the subjects between the previous tag and the bump into the notes, so these are
what the release would say. They are a **draft for your approval** — no commit exists:

```
feat(codex-transport): Replace the deprecated MCP server with a codex exec adapter
feat(codex-transport): Add the transport reference and its exclusivity guards
refactor(review): Switch the gate review families to the exec transport
refactor(skills): Switch the non-gate Codex conversations to the exec transport
docs(readme): Replace MCP registration with the codex exec setup block
chore(release): Bump to 4.6.0
```

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) § 6 Testing Strategy (Acceptance bullet), § 7
- Intent: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md) § Acceptance sketch
- Release mechanism: `.github/workflows/release.yml` (auto-generates notes from commits between tags when `package.json` changes on `main`)
