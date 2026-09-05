# codex-exec adapter and fake-CLI tests

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-09-03
> **Status**: Candidate Complete
> **Note**: Work item 1 of 6 in the tech spec's § 5. Lands the transport **unwired** — no skill, agent or rule references it; the generated README resource inventory is the sole permitted mention, because `scripts/generate-readme-catalog.js` owns that row and its test requires every top-level script in it. Feasibility was proven the same day by a scratchpad spike (21/21 `node:test` cases with a fake `codex`; real `start` → `PING`, `resume` on the same thread → `PING2`, `--profile cli` applied, report 0600, `cleanup` verified, 15 s end to end) — this ticket lands that spike as repository code under the full gates.
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- § 3.2 is the contract this ticket implements
> **Intent**: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md) <- INV-002, INV-003, INV-006, INV-007 bind this ticket

## Background

`codex mcp-server` is deprecated since codex-cli 0.149.0 and will be removed in an unnamed
future release; the plugin reaches Codex only through it. The migration's first slice is the
carrier itself: a thin `codex exec` adapter with a pinned argv, fixed operation classes, fail-closed
preflight, and its own scratch lifecycle — testable without Codex, landed before anything calls it.

## Requirements

- `scripts/codex-exec.js` implements spec § 3.2 exactly: `--protocol 1` first, then `alloc` |
  `start` | `resume --thread-id <uuid>` | `cleanup <dir>`; `--class review|implement`,
  `--prompt-file`, `--report-file`, optional `--profile`; argv array spawn, never a shell string.
- Child argv: `exec [-p <profile>] -s <class sandbox> -c approval_policy="never" -C <toplevel>
  --color never` then `--json -o <report> -` (start) or `resume --json -o <report> <id> -`
  (resume) — safety flags after the profile, flags before the `resume` subcommand.
- Preflight diagnostics and exit codes per § 3.2; the child is never spawned on exit 2.
- Scratch lifecycle per § 3.3 item 2: `alloc` 0700 under `os.tmpdir()`, prompt chmod 0600 at
  preflight, and the report **created by the adapter itself** with `O_CREAT|O_EXCL` then `fchmod`ed
  to 0600 **before the child is spawned** — never a chmod after exit, which would leave the file
  unprotected for the whole run and is not what § 3.2 specifies. On the success path the mode is
  re-read and a run that would report success fails instead if it is no longer exactly 0600.
  `cleanup` refuses any non-`alloc` path.
- Zero npm dependencies, ≤150 lines, asserted by a test.

## Scope

| Scope | Description |
| ----- | ----------- |
| In | The adapter, its `node:test` suite with a fake `codex` fixture, and the maintainer's one real `start`/`resume` acceptance run on the landed copy |
| Out | `codex-transport.md` and the negative guards (item 2); converting any skill (items 3–4); the **transport-facing** README rewrite and the permission sweep (item 5 — the setup section that still documents `codex mcp-server`); `## Codex Profile` setting; anything that makes a skill call the adapter. The generated **resource inventory** row is in scope here, since landing a core script moves it |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `scripts/codex-exec.js` | New | The adapter — installed by `/install-scripts` as a core script by virtue of its location |
| `test/scripts/codex-exec.test.js` | New | Fake-CLI suite: happy paths, every exit-2 diagnostic, every exit-1 failure, cleanup refusal, size budget |
| `test/fixtures/codex-exec/fake-codex.js` | New | Fake `codex` binary driven by `FAKE_CODEX_MODE`; records argv and stdin |

## Acceptance Criteria

- [x] `scripts/codex-exec.js` exposes exactly `alloc`, `start`, `resume`, `cleanup` behind `--protocol 1`; any other protocol value exits 2 with `[CODEX_EXEC_CONFIG] code=protocol_mismatch` before anything else runs
- [x] `start`/`resume` build the § 3.2 argv verbatim for both classes, with `-p` first and `-s`/`-c` after it, and `resume` placing `--json -o <report> <id> -` after the subcommand; prompt bytes reach the child's stdin unchanged
- [x] Every § 3.2 preflight code (`profile_missing`, `invalid_class`, `invalid_profile_name`, `invalid_prompt_file` — incl. a symlinked prompt and a prompt outside the alloc dir, `invalid_report_file` — incl. a report in a different alloc dir, `invalid_thread_id`, `invalid_dir`, `no_git_toplevel`) exits 2 with its `[CODEX_EXEC_CONFIG|USAGE]` line, empty stdout, and no child launch — proven by the fake binary's launch log
- [x] Exit 0 requires child exit 0 ∧ `thread.started` UUID (echoing the supplied id on `resume`) ∧ regular non-empty report; the single stdout line carries `protocol`, `threadId`, `reportFile`, `requestedProfile`, `class`; report and prompt are 0600
- [x] Child nonzero, malformed JSONL, missing `thread.started`, mismatched resume id, empty report and missing binary each exit 1 with `[CODEX_EXEC_ERROR] reason=error` and a bounded stderr tail; `alloc`/`cleanup` filesystem failures exit 1 with `reason=fs`
- [x] `alloc` yields a 0700 directory under `os.tmpdir()`; `cleanup` removes an `alloc` path and exits 2 `invalid_dir` on any other path, leaving it in place
- [x] The suite passes under `npm test`; the adapter is ≤150 lines and requires only `node:*`
  modules (both asserted). **Amended 2026-09-04**: the grep clause as originally written —
  `grep -rl codex-exec skills agents rules` is empty — is false in the landed tree and always would
  have been once item 2 shipped: `codex-transport.md` names the adapter by design, since it is the
  one file INV-001 lets state the operational command lines. `test/scripts/codex-exec.test.js`, test
  `only the canonical transport reference names the adapter`,
  asserts the opposite predicate, `deepEqual(hits, ['skills/codex-code-review/references/codex-transport.md'])`
  — that test was right and this line was stale, caught by the fallback Adequacy Gate. The AC now
  reads: **exactly one hit**, `codex-transport.md`, and no other file under `skills agents rules`
  names the adapter. The README resource row is the one place it must appear as an entry point:
  `scripts/generate-readme-catalog.js` owns that row and its test requires every top-level script in
  it, so the generator's list, the regenerated `README.md`, the five locale mirrors' counts and the
  pinned count in `generate-readme-catalog.test.js` all move together
- [x] Maintainer acceptance on the landed copy: one real `start` and one `resume` on the same `threadId` through the adapter, recorded in Progress with the thread id
- [x] Pass `/codex-review-fast` → `/precommit`
- [x] Pass `/codex-review-doc`

## Test isolation — closed, not narrowed (2026-09-05)

Two prior fixes each narrowed the same weakness in the alloc-fault check
(`test/scripts/codex-exec.test.js`, the three `alloc fails tagged and leaves nothing behind when …`
cases) without closing it, and each was caught measuring the other's residual: a global count
across the shared OS temp root collided with any concurrent `codex-exec-` entry; a before/after
**set difference** of names removed the coincidental-count case but still collided with this same
test *process's own* legitimate `allocDir()` calls elsewhere in the suite landing inside the
snapshot window — measured at roughly 1 run in 10 under **strictly sequential** execution, no
external concurrency involved. The "confirmed not reachable" and "only two people running the same
file by hand" language in the version of this section that made that claim was wrong, and the
citations into the set-difference lines drifted stale within the same revision that wrote them —
both caught by the doc-plane fallback reviewer.

The actual fix removes the shared resource rather than approximating around it: each fault-injection
spawn is given its own **dedicated `TMPDIR`**, an empty directory `os.tmpdir()` reads at that child
process's startup and that nothing else in the suite, or in any other process, ever writes to. The
check no longer scans a name set at all — it lists that directory's own contents after the run and
asserts them empty. Stress-tested 20 consecutive single-process runs, 0 failures (the set-difference
version failed 4/43 the same way).

No `[NIT_DEFERRED]` record applies — this is fixed, not deferred, and the invented `_RESOLVED`
tag an earlier draft of this section used is not part of the closed record vocabulary
(`@rules/scope-discipline.md`), so it is prose here instead: the alloc-fault leak check now isolates
each spawn with its own `TMPDIR` instead of scanning the shared OS temp root, and both prior partial
fixes plus their citation drift are superseded by this section.

## Security fix, and its own sub-threshold residual (2026-09-05)

The fallback code reviewer found two blocking defects in `scripts/security-redact.js`, unrelated to
this ticket's own subject but in the frozen baseline (this branch's other tickets had modified that
file): a `VALUE` regex whose `,;}` exclusion truncated the tail of a secret containing one of those
characters (P0 — a redactor that under-redacts), and a `\b[A-Za-z0-9_-]*` prefix scan that went
quadratic on kebab-case or base64url input (P1 ReDoS, 0ms→40s measured). Both fixed: `VALUE`
reverted to whitespace/quote-only exclusion (byte-identical to `HEAD`), the prefix scan removed
entirely. A second reviewer round confirmed neither reproduces and mutation-tested both directions.

Fixing the P0 exposed a design conflict in `scripts/skills/ui-first-principles/redact.js`: an
earlier patch (this branch, 2026-09-04) had made the JSON-input path relabel a base-masked
credential to `<redacted:credential>`, while the manual-list KV-text path did not — contradicting
both a pre-existing test ("fallback: base redact catches apiKey, credential class does not
double-mask") and a written invariant in `skills/ui-first-principles/SKILL.md`. Resolved by
reverting the relabel entirely rather than extending it to both paths, since the pre-existing test
was the authoritative design signal; five JSON-mode tests that had been written against the wrong
behavior were rewritten to match the real, symmetric one.

One sub-threshold finding logged and passed; a second fixed on the spot:

```
[NIT_DEFERRED] scripts/security-redact.js:49 | VALUE terminates on whitespace and quotes, so a quoted secret containing either is truncated (`pwd="a b c"` -> `pwd="[REDACTED] b c"`); byte-identical to HEAD, not a regression from this change, and closed by the second layer in the ui-first-principles pipeline but not in the recap path | reason: sub-threshold-Nit | 2026-09-04T18:20:09Z
```

`buildMasked`'s hoisted position (a leftover of the now-reverted relabel patch) was fixed on the
spot — moved back to its original position, so the diff to `redact.js` is comment-only. No
`[NIT_DEFERRED]` record applies to it either, for the same reason as the paragraph above: fixed is
not deferred, and a record claiming both at once is the exact contradiction that paragraph exists
to name. (A prior draft of this line used `[NIT_DEFERRED] … reason: sub-threshold-Nit-fixed`, which
was two more defects on top of that one: `Nit-fixed` is not in the closed severity set — the tier
table names `P1 | P2 | Nit` — and the locator was a bare file where every sibling record in this
document uses `file:line`.)

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Spec § 3.2 fixed the contract after a 4-round doc review; scratchpad spike (2026-09-03) proved it end to end, including live `exec resume` continuity |
| Development | Done | `scripts/codex-exec.js` **149 lines** (measured `wc -l`, current), zero deps; `test/scripts/codex-exec.test.js` **52 tests** (`node --test`, current — 33 `test()` declarations, several in tables). A third fallback pass over this ticket (adequacy re-trace) found one more gap the first two rounds missed: the success control record's `reportFile` field — the path every downstream skill reads a report from, per `codex-transport.md` § Completion — was asserted only on the `alloc` record, never on `start`/`resume`; deleting it from `emit()` left the whole suite green. Fixed with one assertion per success path, mutation-proven. The fake-CLI mode header (`fake-codex.js:4`) was also completed to list `replace_report`/`widen_report`, both implemented and already driven by existing tests but missing from the enumeration. Corrected 2026-09-04: this row previously read "137 lines" / "31 tests", which the fallback Adequacy Gate showed matched neither the landed copy nor any single prior revision — the table was drifting behind the code across review rounds. `test/fixtures/codex-exec/fake-codex.js`, `fs-fault.js`. The README resource row moved together across the generator's list, `README.md` + 5 locales and the pinned count in `generate-readme-catalog.test.js` (22 → 23) |
| Testing | Done | `npm test`, measured **2026-09-05**: 4,662 / 4,654 pass / 0 fail / 8 skipped (was 4,265 / 4,257 when this row was first written, and had drifted uncorrected through two prior review rounds — the branch grew 397 tests across sibling tickets and this file's own security fix in that span). `/precommit` `## Overall: ✅ PASS` at code-plane digest current when this row was last edited |
| Acceptance | Done | `/codex-review-fast` ran on the **fallback** carrier — Codex was unavailable (live OpenAI outage, 404 on its responses endpoint; `[REVIEWER_FALLBACK] plane=code_review from=codex to=strict-reviewer reason=error \| 2026-09-03T15:03:34Z`, then P3 after a transient 529). Round 1 `⛔ Blocked` on one P1: a **dangling symlink at `<alloc-dir>/report.md`** passed the `existsSync` preflight, so the child's `-o` wrote — and the adapter chmod'd 0600 — outside the allocated directory, against spec § 3.2. Fixed by defending the report path with `lstat` exactly as the prompt path already was, plus three regression cases and an escape proof; mutation-tested (revert → 2 red, restore → 31/31). Round 2 `✅ Ready × NONE`, validated by `validate-family-sentinel.js code`, `gate_source=fallback:strict-reviewer`. Deferred: `[NIT_DEFERRED]` on unbounded stdout accumulation and on the pre-existing lstat→child-open TOCTOU window. Live acceptance on the **landed** copy, once Codex recovered: this ticket's own `/codex-review-doc` ran through the adapter — `start` then `resume` on thread `01a067e5-7a7e-71d2-98b6-786a12eead51`, both exit 0 with a single control record each (`class=review`, `requestedProfile=null`), the report read from the alloc dir and `cleanup` 0 after each. The outage earlier the same day confirmed the `codex_fail` path just as concretely: adapter exit 1, `[CODEX_EXEC_ERROR] reason=error`, empty stdout. Candidate Complete rather than Completed: no `--verify-ac` closure run |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) § 3.2, § 3.3 item 2, § 5 item 1, § 6
- Intent: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md)
- Precedents: `skills/precommit-fast/SKILL.md` § Auto-install attempt (locator, consumed by item 2); `skills/smart-commit/SKILL.md` § Step 5c execute mode (file-then-script)
