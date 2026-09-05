# Codex Transport (canonical)

**This file is the authority on how a Codex dispatch is carried**: the operational command lines,
the scratch-file lifecycle, and the completion state machine as a whole — the full mapping of every
exit code and non-exit outcome. On any disagreement, this file wins.

Three earlier drafts of this paragraph each claimed something stronger and each was false, so the
claim is now split by what actually holds it up:

| | What is true of it |
|---|---|
| **Mechanically enforced** | Exactly one property, and it is now closed: no operational `codex exec` invocation appears in any file under `skills/`, `agents/` or `rules/` except this one. Guard 1 in `test/rules/codex-transport-guards.test.js` fails if one does. It carried a whole-file exemption for `agents/codex-implementer.md` until work item 4 made that agent an explicit `/codex-implement` router; `GUARD1_PENDING` is now empty and equality-checked, so a new exemption cannot be added silently. That, and only that, is what a test guarantees about exclusivity |
| **Required elsewhere, by another guard** | A fallback-policy site must *name* the trigger — `codex_fail`, adapter **exit 1** on `start`/`resume` — and Guard 5 fails it otherwise. Guard 5's inventory holds seven such sites; the ones a reader meets first are `rules/auto-loop.md` § Review Dispatch, `SKILL.md` § Step 3.5 and `review-common.md` § Degradation Matrix. **Only the trigger identity is pinned.** Each also carries a short list of outcomes that do *not* reach a fallback; those lists are subordinate summaries and nothing checks them, so read them against this file, never instead of it |
| **Convention, unchecked** | Everything else — that call sites cite rather than restate the file lifecycle. `plan-review` is the standing exception (§ Files): it names *that* the prompt is written by heredoc rather than by Write, because its own workflow turns on that, and restates no other lifecycle guarantee |

The reason for any of it is drift: the same predicate restated in thirty call sites loses a copy per
review round (`docs/features/codex-exec-transport/2-tech-spec.md` § 3.4).

The prompt contract is elsewhere and unchanged: `@rules/codex-invocation.md` decides what a prompt
may contain (metadata only on a first dispatch, no fed conclusions, no cumulative attack lists).
This file decides only *how* the prompt is carried.

## Locator

The adapter is `scripts/codex-exec.js`, installed as a core script. Resolve it in this order and
stop at the first hit:

| # | Path | Meaning |
|---|------|---------|
| 1 | `.claude/scripts/codex-exec.js` | Installed copy — the normal path in a consuming project |
| 2 | the plugin's own copy: `~/.claude/plugins/**/sd0x-dev-flow/**/scripts/codex-exec.js`, then `${REPO_ROOT}/node_modules/sd0x-dev-flow/scripts/codex-exec.js`, then plugin-relative `@scripts/codex-exec.js`. **The second `**` is not decoration** — a marketplace cache installs each version separately as `cache/<marketplace>/<plugin>/<version>/scripts/…`, so the one-sided form `plugins/**/sd0x-dev-flow/scripts/…` that `precommit-fast` § Step 1 uses matches the `marketplaces/…/plugins/<plugin>/` and `data/<plugin>/` layouts and misses the versioned one entirely (measured with `fs.globSync`: two of the three layouts match, the versioned path returns `[]`). If it matches **more than one** installed version, that is an ambiguity this cascade cannot resolve — take step 4 and tell the operator to run `/sd0x-dev-flow:install-scripts codex-exec.js`, rather than guessing which version is current | Copy it to `.claude/scripts/` **only when the destination is missing**, then use it. Same auto-install shape as `skills/precommit-fast/SKILL.md` § Step 1 "NOT found → Auto-install attempt", including its skip-on-conflict rule |
| 3 | `scripts/codex-exec.js` | This repository only, developing the plugin itself |
| 4 | — | `setup-required`: surface it to the operator. **Not** `codex_fail`, and no fallback reviewer is dispatched |

Every invocation passes `--protocol 1`. A `[CODEX_EXEC_CONFIG] code=protocol_mismatch` answer means
the installed adapter is incompatible with this contract — older or newer, since the adapter only
compares the supplied protocol against its own constant: tell the operator to run
`/sd0x-dev-flow:install-scripts codex-exec.js --force` and stop. **Never overwrite a conflicting
installed adapter automatically** — a mismatch proves incompatibility, not that the file is an
unmodified plugin artifact (`precommit-fast`'s auto-installer skips on conflict for the same reason).

Locator resolution and any auto-install happen **before** the scope baseline is frozen, so an
install cannot move the digest under a review that has already started.

## Files

One `alloc` per dispatch, and the whole lifecycle repeats for every round — a `resume` gets a
**fresh** directory, never the previous one (preflight refuses an existing report):

```
alloc → Write the prompt → start | resume → Read the report → cleanup
```

`alloc` returns a `0700` directory under the OS temp dir with the two paths inside it; the prompt is
written with the **Write tool** (never a shell heredoc — `skills/smart-commit/SKILL.md` § Step 5c,
execute-mode branch, is the precedent).

**One caller is exempt, structurally**: `plan-review` runs *before* `ExitPlanMode`, and plan mode
blocks the Write tool until the plan is approved — so "use Write" is not advice it can take, and a
contract stating it would be unexecutable rather than strict. It materializes `prompt.md` through the
randomized-delimiter heredoc its own § Redaction already specifies and already had reviewed (a fresh
≥8-hex `PLAN_EOF_<suffix>` per dispatch), under the `Bash(bash:*)` grant it already holds. Nothing
about the transport moves: no new grant is issued, the scratch lifecycle stays the adapter's, and
preflight still `lstat`s the file and chmods it `0600`, so the caller never sets a mode. The general
rule stands for every other caller, and the reason it can: they have a Write tool to use, and no
delimiter discipline of their own.

The recipe lives **here**, not in the skill: INV-001 puts every operational command line in this
document, and a call site spelling one is what Guard 1 exists to catch (measured — it went red the
moment the recipe was drafted into `plan-review/SKILL.md`).

```bash
# 1. Alloc as usual, then read `promptFile` out of the JSON and carry it in the conversation.
node <locator> --protocol 1 alloc

# 2. Write the rendered prompt there. The heredoc belongs to the OUTER shell and `bash -c` only
#    consumes stdin; the path travels as an argument ($0 is the placeholder `_`). The prompt body
#    therefore never sits inside a quoted string, which is the whole point — see below.
bash -c 'cat > "$1"' _ '<promptFile>' <<'PLAN_EOF_<fresh-suffix>'
<the rendered prompt>
PLAN_EOF_<fresh-suffix>
```

**Never nest the heredoc inside the `bash -c` argument.** Writing
`bash -c 'cat > "…" <<'\''DELIM'\'' … DELIM'` puts the rendered prompt inside a single-quoted
string, so the first ASCII apostrophe in the body closes that quote. Measured on bash 3.2.57 with
the stock `plan-review/references/codex-prompt-plan.md`, which contains `Claude's` and needs no
hostile input: the file was written **truncated** at the apostrophe (`Line with Claudes`), and the
words after it were handed to the shell as commands (`PLAN_EOF_…: command not found`) — prompt text
executing as shell, which is the exact risk `plan-review` § Redaction's randomized delimiter exists
to close. The shape above is immune because nothing quotes the body: verified byte-identical output
for a payload carrying an apostrophe, `$VAR`, a backtick and double quotes.

`<locator>` is the cascade at § Locator, never a hardcoded path — `.claude/scripts/codex-exec.js`
does not exist in this development checkout, where the same cascade resolves `scripts/codex-exec.js`.
The delimiter is collision-checked against the **fully rendered prompt body**, not the plan text
alone: the template's own sections travel in the same heredoc, so a suffix absent from the plan can
still occur in what is written. No prompt or report artifact is written inside the repository, so review
artifacts never move the tree digest. (The locator may install the adapter itself at
`.claude/scripts/codex-exec.js` — that is a one-time setup write, not a review artifact.) `cleanup <dir>` runs after that dispatch's report has been
read — for a background call, only after its completion notification has been consumed.

**Confidentiality is layered, and the layers are worth stating exactly** — an earlier draft promised
an unconditional file mode that no adapter at this privilege level can deliver:

| Layer | What it guarantees | Limit |
|-------|--------------------|-------|
| The `0700` directory | Another user cannot traverse into it, whatever the files inside are set to. This is the boundary that actually holds | The adapter creates it; it does not police it afterwards |
| Atomic creation of the **report** | The adapter creates `report.md` itself with `O_CREAT\|O_EXCL` — refusing any squatter at the path, a dangling symlink included — then `fchmod`s that descriptor to exactly `0600`. The `fchmod` is not decoration: a create-mode argument is masked by the ambient umask (measured: `umask 277` yields `0400`), which the success check below would then reject | Protects the inode it created, not the pathname forever |
| Preflight on the **prompt** | The caller writes `prompt.md` with the Write tool — except `plan-review`, whose exemption is stated above; preflight then requires a regular, readable, non-empty file at that exact path inside the alloc dir (`lstat`, so a symlink is refused) and chmods it `0600` | It validates a file it did not create, so it cannot claim the report's creation-time guarantee |
| The success check | A run that would report success re-reads the mode and fails instead if it is not `0600` | Refuses to *call* a widened report a success; it cannot un-widen one |

What is deliberately **not** claimed: an absolute guarantee against the child itself. `codex` runs as
the same user and could chmod or replace the file; defending against that needs privilege or
ownership isolation, not a mode bit, and `codex` is the tool we chose to run, not an adversary. What
was tried and removed: a process-wide `umask(077)` before spawn — it did constrain a replacement
report, but the child inherits it for **everything**, so under `--class implement` every workspace
file Codex generated would have come out `0600` and every directory `0700` instead of the caller's
own defaults. A report-scoped control may not reach outside the report.

No dedicated `mktemp`, `chmod` or `rm` command grant is needed or added, and the choreography
documented here invokes none of those utilities: `alloc` and `cleanup` are the adapter's. That is a
statement about what this contract requires, not a capability bound — a caller holding
`Bash(bash:*)` could run any of them, as § Permission says of every broad grant.

## Alloc

```bash
node <locator> --protocol 1 alloc
```

Prints one line: `{"protocol":1,"dir":…,"promptFile":…,"reportFile":…}`.

## Start

```bash
node <locator> --protocol 1 start --class review \
  --prompt-file <dir>/prompt.md --report-file <dir>/report.md [--profile <name>]
```

Use `start` for a first dispatch and for a thread rotation. `--class implement` exists for exactly
one caller — `skills/codex-implement/` — and gives Codex `workspace-write`; every other skill,
review or conversation, passes `--class review` (`read-only`). Guard 3 pins that ownership.

Both classes pin `approval_policy="never"`, and that is a deliberate, stated delta from the MCP era's
`on-failure`: `codex exec` is non-interactive, so nobody can answer an approval prompt — `on-failure`
could only hang or fail. For `codex-implement` the human control is unchanged and lives in the skill:
its Step 3b displays the complete changeset by its own procedure and asks the user to accept, reject or modify each item. The command belongs to the skill, not here — naming it in both places is what let this file keep saying `git diff` after the skill had corrected it.

## Resume

```bash
node <locator> --protocol 1 resume --thread-id <uuid> --class <the caller's class> \
  --prompt-file <dir>/prompt.md --report-file <dir>/report.md [--profile <name>]
```

**The class is the caller's, exactly as on § Start, and it does not change across a thread**: a
`codex-implement` continuation resumes with `--class implement` or Codex cannot make the edits the
reply asks for; every other caller resumes with `--class review`. Naming one class here would have
silently downgraded write-capable continuations to `read-only`.

`resume` continues the thread the previous dispatch returned. Keep the term `threadId` in skills and
reports; it is what `--continue <threadId>` has always meant. Nothing persists it — the orchestrator
remembers it in conversation, and `review-state.js` deliberately carries no thread id.

Rotation is unchanged and stays behaviour-layer: at the R-a threshold or on judged context overrun
(`review-common.md` § Review Loop — Thread Rotation), the next dispatch is a **`start`** on a new
thread with the family's first-dispatch template, and `[THREAD_ROTATED]` is recorded. The adapter
knows nothing about rounds or rotation.

## Cleanup

```bash
node <locator> --protocol 1 cleanup <dir>
```

Refuses any path that is not an `alloc`-shaped directory under the OS temp dir.

## Completion state machine

**This section governs `start` and `resume` only.**

| Outcome | Reading |
|---------|---------|
| Launched, not yet finished | `pending` — a launch is **not** a verdict. No gate verdict, no probe result, no `review-state.js` note exists yet |
| Exit 0 | `codex_ok`. Requires **all** of: the child exited 0, a valid `threadId`, a non-empty report — **and the whole prompt written without a write error** (the stdin stream reached `finish`). Not pedantry: a child that dies mid-write on a 2 MiB prompt still emits a valid thread event and writes a valid report, so without this conjunct the adapter reports a completed review of a prompt the reviewer only half received (measured; `test/scripts/codex-exec.test.js`). **Its limit, stated because the honest claim is narrower than it looks**: `finish` proves the bytes entered the pipe, never that the child read them. A prompt small enough to fit the pipe buffer is fully written even if the child reads one line and exits — that run exits 0 and nothing here can tell. Proving *consumption* needs an acknowledgement in the child's own protocol, which `codex exec` does not offer; the residual is accepted and characterized in that suite rather than papered over. One control record on stdout: `{"protocol":1,"threadId":…,"reportFile":…,"requestedProfile":…,"class":…}`; the report is at `reportFile` |
| Exit 1 | `codex_fail` — `[CODEX_EXEC_ERROR] reason=…` on stderr. **What follows depends on what the dispatch carries.** A gate family with a carrier (`code`, `doc`, `plan`, `test:*`) routes through `scripts/lib/review-dispatch.js` with `probe:'codex_fail'`, records `[REVIEWER_FALLBACK]`, and stays on the fallback path for the rest of this change — sticky means Codex is not re-probed, **not** that one carrier is fixed: a failed validation advances to the next carrier in the family's list. The next change probes afresh. **`necessity` is a gate with no carrier** — its Codex debate pipeline is constitutive, so `review-dispatch.js` defines none and it degrades terminally in place (`@rules/auto-loop.md` § Review Dispatch excludes it from fallback and rotation); an earlier draft of this row listed it with the others, which the dispatcher contradicts. A **non-gate conversation** dispatch — brainstorm, explain, implement, recap, verdict — has no contract in that table at all: it degrades in place, says so in its own output, and notes nothing. Sending one through `review-dispatch.js` is not a stricter reading, it is an unexecutable instruction |
| Exit 2 | Configuration or usage — `[CODEX_EXEC_CONFIG]` / `[CODEX_EXEC_USAGE]` with a `code=`. Fix the setup; **no reviewer was dispatched**, so no fallback and no note |
| Completion status unknown | The gate **stays open**. No fallback, no note, no verdict |

An `alloc` or `cleanup` failure is a lifecycle error surfaced to the operator: it never calls
`review-dispatch.js`, never sets the probe, and never counts as a Codex outcome.

A dispatch expected to approach the foreground tool ceiling — a `thorough` tier, a large diff — is
launched with `Bash(run_in_background: true)` and awaited by its completion notification. The
adapter owns no timeout and never retries.

Remediation by diagnostic code:

| Diagnostic | Action |
|------------|--------|
| adapter not found at any locator step | `/sd0x-dev-flow:install-scripts codex-exec.js` |
| `protocol_mismatch`, or exit 2 with no recognizable code from an old adapter | `/sd0x-dev-flow:install-scripts codex-exec.js --force` |
| `profile_missing` | Fix `## Codex Profile`, or create `$CODEX_HOME/<name>.config.toml` |
| `invalid_class`, `invalid_profile_name`, `invalid_prompt_file`, `invalid_report_file`, `invalid_thread_id`, `invalid_dir`, `no_git_toplevel` | Correct this invocation — a choreography defect; do not dispatch a fallback |

## Profile

`rules/auto-loop-project.md ## Codex Profile` names one Codex profile for every dispatch; unset means
no `-p` and Codex's own default configuration. The adapter fail-closes when
`$CODEX_HOME/<name>.config.toml` does not exist, because `codex exec` otherwise runs an unknown
profile **silently** (measured 2026-09-03, codex-cli 0.149.0).

**Profile selection is not tier-dependent in v1.** `## Codex Profile` selects one user-defined
profile for all Codex `start` and `resume` dispatches. The auto-loop tier continues to govern review
scope, blocking severity and round caps. A tier-to-profile map is a future setting and must not be
inferred from profile names.

The profile is *project-selected, user-defined* configuration: the name lives here, the definition
lives in the operator's `$CODEX_HOME`, so two machines can resolve it differently. The
`requestedProfile` field in the control record is the audit trail.

## Permission

A skill that dispatches Codex itself declares `Bash(node:*)`, `Write` and `Read` — `plan-review` is
the one exemption, and § Files says why. A skill that only routes to another skill carries no
dispatch instruction in its body and is issued no **transport** grant — no `Bash(node:*)`, no
`Write`.

That is narrower than "no Bash grant", deliberately: a router keeps whatever `Bash(git:*)` or
`Bash(bash:*)` its own steps already needed (`codex-review-fast` and `codex-review-branch` hold both,
`codex-review-doc` holds the first). **What that retention states is ownership, not enforcement.**
`Bash(bash:*)` can run node, this adapter, or `codex` itself, so no grant string prevents a dispatch
and none is claimed to — the boundary is that the router's documented workflow contains no dispatch
and it receives nothing extra with which to perform one. `Bash(node:*)` is no different: it is
equivalent in effective authority to `Bash(bash:*)`, so the real boundary is the adapter's pinned
safety flags and its class sandbox, never the grant string.
`test/rules/codex-transport-guards.test.js` Guard 4 pins the router pair in both directions.
