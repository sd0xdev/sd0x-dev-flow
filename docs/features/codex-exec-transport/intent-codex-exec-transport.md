# Intent — codex-exec-transport

> **Doc class**: Intent (ancillary — Design record). Written by the planner, checked by the
> implementer. Work that contradicts an Invariant or Non-goal stops and asks — amending this
> file is a re-decision, not a sync.

## North star

Replace the deprecated `codex mcp-server` transport (`mcp__codex__codex` / `codex-reply`) with a
`codex exec`-based one so the review loop keeps its independent second reviewer when the
subcommand is removed — and change **only the carrier**: every prompt contract, dispatch rule,
sentinel, rotation threshold and anchor stays where it is.

## Non-goals

- No `codex app-server` client, self-hosted MCP shim, or `codex review` as transport (its native output cannot carry the family sentinels).
- No dual backend: MCP and exec are never selectable side by side; the switch is one versioned change.
- The adapter renders no prompts, parses no sentinels, keeps no state, retries nothing, owns no
  timeout; no tier→profile mapping in v1; no new Anchor Register item, gate sentinel or human exit.
- No change to `review-dispatch.js`, `validate-family-sentinel.js`, the Degradation Matrix, R-a/R-b rotation, or `run-skill.sh`.
- No automatic overwrite of a conflicting installed adapter: a protocol mismatch asks for an explicit one-file forced reinstall (`precommit-fast` "skip on conflict" precedent).

## Invariants

- `INV-001`: **One transport authority.** `skills/codex-code-review/references/codex-transport.md`
  is the sole statement of the invocation, file, stdout, exit and background contracts; an
  operational `codex exec` command line appears only there, in `scripts/codex-exec.js`, and in
  that script's tests/fixtures. Prompt templates are body-only; call sites cite the reference.
- `INV-002`: **Thin, transport-only adapter.** `scripts/codex-exec.js` is ≤150 lines, zero npm
  dependencies, spawns `codex` with an argv array (never a shell string), and offers two fixed
  operation classes chosen by the skill, never by passthrough — `review` (`-s read-only`) and
  `implement` (`-s workspace-write`, `codex-implement` only) — each pinned with
  `-c approval_policy="never" -C <git-toplevel> --color never --json -o <report>` after any profile
  (`on-failure` has no headless equivalent); exactly one JSONL event (`thread.started`) has meaning.
- `INV-003`: **Exit semantics are the probe — for `start`/`resume`.** Exit 0 ⇔ Codex exited 0 ∧
  `protocol` echoed ∧ valid `threadId` ∧ non-empty report ∧ the prompt stream reached `finish`
  (added 2026-09-04 — a child dying mid-write satisfied every other conjunct; `finish` proves the
  prompt was *written*, never that the child read it — see the transport reference for that limit). Exit 1 = `codex_fail` (fallback per the
  Degradation Matrix). Exit 2 = configuration/usage (`[CODEX_EXEC_CONFIG]` / `[CODEX_EXEC_USAGE]`) —
  never `codex_fail`, never a fallback trigger. `alloc`/`cleanup` exit 0 on success, 2 on invalid
  input, 1 on a filesystem failure; none of their exits is a probe result.
- `INV-004`: **Thread continuation is preserved.** `resume <threadId>` carries the same-thread semantics
  of `rules/codex-invocation.md` § Loop review exception and the rotation rule; the term stays `threadId`; no state store carries it.
- `INV-005`: **A launch is not a verdict.** Background launch ⇒ `pending`; a verdict, a probe
  result or a review-state note exists only after completion status is known; unknown
  completion keeps the gate open and dispatches no fallback.
- `INV-006`: **One configuration knob.** Only `--profile <name>` is accepted; the adapter
  fail-closes (exit 2) when `$CODEX_HOME/<name>.config.toml` is absent, because `codex exec`
  silently runs an unknown profile (measured 2026-09-03, codex-cli 0.149.0).
- `INV-007`: **Permission surface grows only where transport is owned.** Direct callers gain
  `Bash(node:*)` + Write + Read; delegating skills gain nothing; the scratch lifecycle is the
  adapter's — `alloc` the 0700 dir, preflight the prompt's mode and the report's exclusive
  creation, `cleanup` the removal — never a shell grant. The caller writes `prompt.md`; it never
  sets a mode. Register #2, #3, #6 hold.

  **Amended 2026-09-04, user-approved re-decision.** The original text said the caller writes the
  prompt *with the Write tool*, and named no exception. `plan-review` cannot satisfy that: it runs
  before `ExitPlanMode`, where plan mode withholds Write, so the rule was not strict but
  unexecutable — the skill could not dispatch at all. **One exemption, and it is closed**:
  `plan-review` materializes `prompt.md` through the collision-checked randomized-delimiter heredoc
  its own § Redaction already specifies, under a `Bash(bash:*)` grant it already held. Every
  substantive clause above still holds under it — no grant is added, the scratch lifecycle stays the
  adapter's, and preflight still sets the mode, so the caller still never sets one. A second
  exemption would be another re-decision, not an extension of this one.

## Acceptance sketch

In a consuming project with no `.claude/scripts/codex-exec.js`, `/codex-review-fast` locates the
plugin copy via the precommit three-level Glob, installs it, then per dispatch: `alloc` → Write
prompt → `node .claude/scripts/codex-exec.js --protocol 1 start --class review --prompt-file
<dir>/prompt.md --report-file <dir>/report.md --profile review` → read the control record (`threadId`)
and `report.md` → derive the gate → `cleanup <dir>`; the next round repeats with a fresh `alloc` and
`resume --thread-id <same id>`. A mismatched adapter prints `[CODEX_EXEC_CONFIG] code=protocol_mismatch`,
exits 2, no fallback runs, and the operator is told `/install-scripts codex-exec.js --force`. `npm test` proves no `mcp__codex` survives in active `skills/`, `agents/`, `rules/`.
